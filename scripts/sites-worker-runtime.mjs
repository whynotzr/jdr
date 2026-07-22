const TOKEN_COLORS = ["#e15a4f", "#2f9e7e", "#da9a28", "#4e79d8", "#8a65c8", "#2f4858"];
const SCENE_MOODS = new Set(["donjon", "foret", "taverne", "combat", "mystique", "nuit"]);
const TABLE_FX = new Set(["runes", "feu", "eclair", "brume"]);
const STATE_KEYS = ["rooms", "accounts"];
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};
const memoryStore = { rooms: {}, accounts: {}, initialized: false };

const worker = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }

      if (request.method === "POST" && url.pathname === "/api/mj/open") {
        const store = await loadStore(env);
        const body = await readJson(request);
        const account = await authenticateMjAccount(store, body, { createIfMissing: true });
        const { room, participant } = openMjRoom(store, account, body);
        await saveStore(env, store);
        return jsonResponse(200, {
          account: publicMjAccount(store, account),
          session: {
            clientId: participant.id,
            room: room.code,
            name: participant.name,
            role: participant.role,
            account: account.username
          },
          state: publicState(room, participant)
        });
      }

      if (request.method === "POST" && url.pathname === "/api/mj/rooms") {
        const store = await loadStore(env);
        const body = await readJson(request);
        const account = await authenticateMjAccount(store, body);
        return jsonResponse(200, { account: publicMjAccount(store, account) });
      }

      if (request.method === "POST" && url.pathname === "/api/login") {
        const store = await loadStore(env);
        const body = await readJson(request);
        const code = normalizeRoom(body.room);
        const room = store.rooms[code];
        if (!room) {
          return jsonResponse(404, { error: "Salle introuvable. Demande le lien au MJ." });
        }

        normalizeRoomState(room);
        if (body.role === "MJ") {
          return jsonResponse(403, { error: "Le MJ doit passer par son compte." });
        }

        const participant = addParticipantToRoom(room, body.name, "Joueur");
        touch(room);
        await saveStore(env, store);
        return jsonResponse(200, {
          session: {
            clientId: participant.id,
            room: room.code,
            name: participant.name,
            role: participant.role
          },
          state: publicState(room, participant)
        });
      }

      if (request.method === "GET" && url.pathname === "/api/state") {
        const store = await loadStore(env);
        const room = ensureRoom(store, url.searchParams.get("room"));
        const viewer = room.participants[url.searchParams.get("clientId")] || null;
        if (viewer) {
          viewer.online = true;
          viewer.lastSeen = new Date().toISOString();
          touch(room);
          await saveStore(env, store);
        }
        return jsonResponse(200, publicState(room, viewer));
      }

      if (request.method === "GET" && url.pathname === "/api/events") {
        return streamRoomState(request, env, ctx, url);
      }

      if (request.method === "GET" && url.pathname === "/api/info") {
        return jsonResponse(200, { localUrl: url.origin, networkUrls: [] });
      }

      if (request.method === "POST" && url.pathname === "/api/action") {
        const store = await loadStore(env);
        const body = await readJson(request);
        const room = ensureRoom(store, body.room);
        const actor = room.participants[body.clientId];
        if (!actor) {
          return jsonResponse(401, { error: "Reconnecte-toi avant d'agir." });
        }

        handleAction(room, actor, body.action, body.payload || {});
        await saveStore(env, store);
        return jsonResponse(200, { ok: true, state: publicState(room, actor) });
      }

      if (request.method === "GET") {
        return staticResponse(url.pathname);
      }

      return jsonResponse(405, { error: "Methode non autorisee" });
    } catch (error) {
      return jsonResponse(400, { error: error?.message || "Erreur" });
    }
  }
};

async function streamRoomState(request, env, ctx, url) {
  const roomCode = normalizeRoom(url.searchParams.get("room"));
  const clientId = url.searchParams.get("clientId");
  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode("retry: 1500\n\n"));
      for (let index = 0; index < 160 && !closed; index += 1) {
        try {
          const store = await loadStore(env);
          const room = ensureRoom(store, roomCode);
          const viewer = room.participants[clientId] || null;
          if (viewer) {
            viewer.online = true;
            viewer.lastSeen = new Date().toISOString();
            touch(room);
            await saveStore(env, store);
          }
          controller.enqueue(encoder.encode(formatSse("state", publicState(room, viewer))));
        } catch (error) {
          controller.enqueue(encoder.encode(formatSse("error", { error: error?.message || "Erreur" })));
        }

        await delay(1500);
      }
      controller.close();
    },
    cancel() {
      closed = true;
      if (ctx?.waitUntil) {
        ctx.waitUntil(markOffline(env, roomCode, clientId));
      }
    }
  });

  request.signal?.addEventListener?.("abort", () => {
    closed = true;
    if (ctx?.waitUntil) {
      ctx.waitUntil(markOffline(env, roomCode, clientId));
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
      ...CORS_HEADERS
    }
  });
}

async function markOffline(env, roomCode, clientId) {
  if (!clientId) {
    return;
  }
  const store = await loadStore(env);
  const room = store.rooms[roomCode];
  const participant = room?.participants?.[clientId];
  if (!participant) {
    return;
  }
  participant.online = false;
  participant.lastSeen = new Date().toISOString();
  if (room.activeTurnPlayerId === participant.id) {
    clearTurn(room);
  }
  touch(room);
  await saveStore(env, store);
}

function formatSse(event, payload) {
  return "event: " + event + "\n" + "data: " + JSON.stringify(payload) + "\n\n";
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJson(request) {
  if (!request.body) {
    return {};
  }
  const text = await request.text();
  return text ? JSON.parse(text) : {};
}

function staticResponse(pathname) {
  const route = pathname === "/" ? "/index.html" : pathname;
  const asset = STATIC_ASSETS[route];
  if (!asset) {
    return new Response("Introuvable", { status: 404 });
  }
  return new Response(asset.body, {
    headers: {
      "Content-Type": asset.contentType,
      "Cache-Control": "no-store",
      ...CORS_HEADERS
    }
  });
}

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...CORS_HEADERS
    }
  });
}

async function ensureSchema(env) {
  if (!env?.DB) {
    memoryStore.initialized = true;
    return;
  }

  await env.DB.prepare("CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
}

async function loadStore(env) {
  await ensureSchema(env);
  if (!env?.DB) {
    return structuredClone(memoryStore);
  }

  const store = { rooms: {}, accounts: {} };
  for (const key of STATE_KEYS) {
    const row = await env.DB.prepare("SELECT value FROM app_state WHERE key = ?").bind(key).first();
    if (row?.value) {
      try {
        store[key] = JSON.parse(row.value);
      } catch {
        store[key] = {};
      }
    }
  }

  for (const room of Object.values(store.rooms)) {
    normalizeRoomState(room);
  }
  return store;
}

async function saveStore(env, store) {
  if (!env?.DB) {
    memoryStore.rooms = structuredClone(store.rooms || {});
    memoryStore.accounts = structuredClone(store.accounts || {});
    memoryStore.initialized = true;
    return;
  }

  const updatedAt = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("INSERT OR REPLACE INTO app_state (key, value, updated_at) VALUES (?, ?, ?)").bind("rooms", JSON.stringify(store.rooms || {}), updatedAt),
    env.DB.prepare("INSERT OR REPLACE INTO app_state (key, value, updated_at) VALUES (?, ?, ?)").bind("accounts", JSON.stringify(store.accounts || {}), updatedAt)
  ]);
}

function ensureRoom(store, roomCode) {
  const code = normalizeRoom(roomCode);
  if (!store.rooms[code]) {
    store.rooms[code] = {
      code,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      participants: {},
      activeTurnPlayerId: null,
      activeRoll: null,
      diceLog: [],
      characters: [],
      tokens: [],
      drawings: [],
      redoDrawings: [],
      savedDrawings: [],
      activeSavedDrawingId: null,
      boardNotes: "Notes MJ: objectif de la scene, dangers visibles, indices a retenir...",
      fieldNotes: defaultFieldNotes(),
      gameClock: {
        day: 1,
        time: "08:00",
        weather: "Temps couvert",
        temperature: 8,
        noise: "faible",
        threat: "moyenne",
        updatedAt: new Date().toISOString(),
        updatedBy: "MJ"
      },
      scene: {
        title: "Scene en cours",
        mood: "donjon",
        threat: 0,
        notice: "",
        updatedAt: new Date().toISOString(),
        updatedBy: "MJ"
      },
      activeFx: null
    };
  }

  normalizeRoomState(store.rooms[code]);
  return store.rooms[code];
}

function normalizeRoomState(room) {
  room.participants ||= {};
  room.diceLog ||= [];
  room.characters ||= [];
  room.tokens ||= [];
  room.drawings ||= [];
  room.redoDrawings ||= [];
  room.savedDrawings ||= [];
  room.activeSavedDrawingId ||= null;
  room.boardNotes ||= "";
  room.fieldNotes = normalizeFieldNotes(room.fieldNotes, room.boardNotes);
  room.gameClock = normalizeGameClock(room.gameClock);
  room.activeRoll ||= null;
  room.scene = normalizeScene(room.scene);
  room.activeFx ||= null;

  const now = Date.now();
  for (const player of Object.values(room.participants)) {
    const seen = new Date(player.lastSeen || player.joinedAt || 0).getTime();
    player.online = Number.isFinite(seen) && now - seen < 45000;
  }

  const activeTurn = room.participants[room.activeTurnPlayerId];
  if (!activeTurn || !activeTurn.online || activeTurn.role === "MJ") {
    room.activeTurnPlayerId = null;
  }
}

function normalizeRoom(value) {
  const clean = String(value || "TABLE-1")
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
  return clean || "TABLE-1";
}

function normalizeAccountUsername(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 32);
}

function sanitizeText(value, maxLength = 80) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function sanitizeLongText(value, maxLength = 3000) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .slice(0, maxLength);
}

async function hashPassword(password, salt = randomHex(16)) {
  const data = new TextEncoder().encode(salt + ":" + String(password));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return { salt, hash: hexFromBuffer(digest) };
}

async function verifyPassword(password, account) {
  if (!account?.passwordHash || !account?.passwordSalt) {
    return false;
  }
  const actual = await hashPassword(password, account.passwordSalt);
  return actual.hash === account.passwordHash;
}

async function authenticateMjAccount(store, payload, { createIfMissing = false } = {}) {
  const username = normalizeAccountUsername(payload.username);
  const password = String(payload.password || "");
  const displayName = sanitizeText(payload.displayName, 40);

  if (!username) {
    throw new Error("Choisis un identifiant MJ.");
  }
  if (password.length < 4) {
    throw new Error("Le mot de passe MJ doit faire au moins 4 caracteres.");
  }

  let account = store.accounts[username];
  if (!account) {
    if (!createIfMissing) {
      throw new Error("Compte MJ introuvable.");
    }

    const passwordData = await hashPassword(password);
    account = {
      username,
      displayName: displayName || username,
      passwordSalt: passwordData.salt,
      passwordHash: passwordData.hash,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    store.accounts[username] = account;
    return account;
  }

  if (!(await verifyPassword(password, account))) {
    throw new Error("Mot de passe MJ incorrect.");
  }

  if (displayName && account.displayName !== displayName) {
    account.displayName = displayName;
  }
  account.updatedAt = new Date().toISOString();
  return account;
}

function publicMjAccount(store, account) {
  return {
    username: account.username,
    displayName: account.displayName,
    rooms: roomsForAccount(store, account.username)
  };
}

function roomsForAccount(store, username) {
  return Object.values(store.rooms)
    .filter((room) => room.ownerAccount === username)
    .sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime())
    .map((room) => ({
      code: room.code,
      updatedAt: room.updatedAt,
      createdAt: room.createdAt,
      players: Object.values(room.participants || {}).filter((player) => player.role !== "MJ").length,
      characters: (room.characters || []).length,
      savedDrawings: (room.savedDrawings || []).length
    }));
}

function defaultFieldNotes() {
  return {
    notes: "# Notes\n- Zone a explorer\n",
    objectives: "# Objectifs\n[ ] Securiser la zone\n[ ] Trouver des vivres\n",
    clues: "# Indices\n- Radio brouillee\n",
    dangers: "# Dangers\n- Rodeurs proches\n",
    secrets: "# Secrets MJ\n- A completer\n"
  };
}

function normalizeFieldNotes(notes = {}, legacyNotes = "") {
  const defaults = defaultFieldNotes();
  const source = notes && typeof notes === "object" && !Array.isArray(notes) ? notes : {};
  return {
    notes: sanitizeLongText(source.notes || legacyNotes || defaults.notes, 3500),
    objectives: sanitizeLongText(source.objectives || defaults.objectives, 2500),
    clues: sanitizeLongText(source.clues || defaults.clues, 2500),
    dangers: sanitizeLongText(source.dangers || defaults.dangers, 2500),
    secrets: sanitizeLongText(source.secrets || defaults.secrets, 2500)
  };
}

function publicFieldNotes(room, actor) {
  const notes = normalizeFieldNotes(room.fieldNotes, room.boardNotes);
  if (actor?.role === "MJ") {
    return notes;
  }
  return {
    notes: notes.notes,
    objectives: notes.objectives,
    clues: notes.clues,
    dangers: notes.dangers,
    secrets: ""
  };
}

function normalizeScene(scene = {}) {
  const mood = SCENE_MOODS.has(String(scene.mood)) ? String(scene.mood) : "donjon";
  return {
    title: sanitizeText(scene.title, 80) || "Scene en cours",
    mood,
    threat: clampInt(scene.threat, 0, 6),
    notice: sanitizeLongText(scene.notice, 220),
    updatedAt: scene.updatedAt || new Date().toISOString(),
    updatedBy: sanitizeText(scene.updatedBy, 40) || "MJ"
  };
}

function normalizeGameClock(clock = {}) {
  return {
    day: clampInt(clock.day || 1, 1, 9999),
    time: normalizeClockTime(clock.time),
    weather: sanitizeText(clock.weather, 40) || "Temps couvert",
    temperature: clampInt(clock.temperature ?? 8, -40, 60),
    noise: normalizeChoice(clock.noise, ["faible", "moyen", "fort"], "faible"),
    threat: normalizeChoice(clock.threat, ["basse", "moyenne", "haute", "extreme"], "moyenne"),
    updatedAt: clock.updatedAt || new Date().toISOString(),
    updatedBy: sanitizeText(clock.updatedBy, 40) || "MJ"
  };
}

function normalizeClockTime(value) {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return "08:00";
  }
  const hours = clampInt(match[1], 0, 23);
  const minutes = clampInt(match[2], 0, 59);
  return String(hours).padStart(2, "0") + ":" + String(minutes).padStart(2, "0");
}

function normalizeChoice(value, choices, fallback) {
  const clean = String(value || "").trim().toLowerCase();
  return choices.includes(clean) ? clean : fallback;
}

function sanitizeColor(value, fallback = "#e15a4f") {
  const color = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

function clamp(number, min, max) {
  const parsed = Number(number);
  if (!Number.isFinite(parsed)) {
    return min;
  }
  return Math.min(max, Math.max(min, parsed));
}

function clampInt(number, min, max) {
  return Math.trunc(clamp(number, min, max));
}

function sanitizeStat(value, fallback = 10) {
  if (value === undefined || value === null || value === "") {
    return String(clampInt(fallback, 0, 20));
  }
  return String(clampInt(value, 0, 20));
}

function publicState(room, actor = null) {
  const activeTurn = room.participants?.[room.activeTurnPlayerId] || null;
  return {
    code: room.code,
    updatedAt: room.updatedAt,
    participants: Object.values(room.participants || {}).sort((a, b) => a.name.localeCompare(b.name)),
    turn: activeTurn
      ? {
          id: activeTurn.id,
          name: activeTurn.name,
          role: activeTurn.role,
          color: activeTurn.color,
          online: activeTurn.online
        }
      : null,
    activeRoll: room.activeRoll || null,
    diceLog: room.diceLog || [],
    characters: room.characters || [],
    tokens: room.tokens || [],
    drawings: room.drawings || [],
    savedDrawings: (room.savedDrawings || []).map((drawing) => ({
      id: drawing.id,
      name: drawing.name,
      strokeCount: drawing.strokeCount,
      version: drawing.version || 1,
      thumbnail: drawing.thumbnail || "",
      createdAt: drawing.createdAt,
      updatedAt: drawing.updatedAt,
      updatedBy: drawing.updatedBy
    })),
    activeSavedDrawingId: room.activeSavedDrawingId || null,
    boardNotes: room.boardNotes || "",
    fieldNotes: publicFieldNotes(room, actor),
    gameClock: normalizeGameClock(room.gameClock),
    scene: normalizeScene(room.scene),
    activeFx: room.activeFx || null
  };
}

function touch(room) {
  room.updatedAt = new Date().toISOString();
}

function createParticipant(name, role) {
  const id = crypto.randomUUID();
  const color = TOKEN_COLORS[randomInt(0, TOKEN_COLORS.length)];
  return {
    id,
    name: sanitizeText(name, 40) || "Invite",
    role: role === "MJ" ? "MJ" : "Joueur",
    color,
    online: true,
    joinedAt: new Date().toISOString(),
    lastSeen: new Date().toISOString()
  };
}

function addParticipantToRoom(room, name, role) {
  const participant = createParticipant(name, role);
  for (const [participantId, oldParticipant] of Object.entries(room.participants)) {
    if (!oldParticipant.online && oldParticipant.name === participant.name && oldParticipant.role === participant.role) {
      delete room.participants[participantId];
    }
  }
  room.participants[participant.id] = participant;
  return participant;
}

function openMjRoom(store, account, payload) {
  const room = ensureRoom(store, payload.room);
  if (room.ownerAccount && room.ownerAccount !== account.username) {
    throw new Error("Cette table appartient deja a un autre compte MJ.");
  }

  room.ownerAccount = account.username;
  room.ownerName = account.displayName;
  room.savedAt = new Date().toISOString();
  const participant = addParticipantToRoom(room, account.displayName, "MJ");
  touch(room);
  return { room, participant };
}

function getTurnParticipants(room) {
  const participants = Object.values(room.participants || {});
  const onlinePlayers = participants.filter((player) => player.online && player.role !== "MJ");
  const onlineEveryone = participants.filter((player) => player.online);
  const turnList = onlinePlayers.length ? onlinePlayers : onlineEveryone;
  return turnList.sort((a, b) => {
    const joinedDiff = new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime();
    return joinedDiff || a.name.localeCompare(b.name);
  });
}

function advanceTurn(room) {
  moveTurn(room, 1);
}

function retreatTurn(room) {
  moveTurn(room, -1);
}

function moveTurn(room, direction) {
  const turnList = getTurnParticipants(room);
  if (turnList.length === 0) {
    room.activeTurnPlayerId = null;
    return;
  }
  const currentIndex = turnList.findIndex((player) => player.id === room.activeTurnPlayerId);
  const normalizedIndex = currentIndex >= 0 ? currentIndex : direction > 0 ? -1 : 0;
  const nextIndex = (normalizedIndex + direction + turnList.length) % turnList.length;
  room.activeTurnPlayerId = turnList[nextIndex].id;
}

function setTurn(room, playerId) {
  const player = room.participants[playerId];
  if (!player) {
    throw new Error("Joueur introuvable.");
  }
  if (player.role === "MJ") {
    throw new Error("Choisis un joueur pour lui donner le droit de lancer.");
  }
  if (!player.online) {
    throw new Error("Ce joueur n'est pas connecte.");
  }
  room.activeTurnPlayerId = player.id;
}

function clearTurn(room) {
  room.activeTurnPlayerId = null;
}

function kickParticipant(room, actor, playerId) {
  const target = room.participants[playerId];
  if (!target) {
    throw new Error("Participant introuvable.");
  }
  if (target.id === actor.id) {
    throw new Error("Le MJ actif ne peut pas se retirer lui-meme.");
  }
  delete room.participants[target.id];
  if (room.activeTurnPlayerId === target.id) {
    clearTurn(room);
  }
}

function handleRoll(room, actor, payload) {
  const realSides = clampInt(payload.sides, 2, 1000);
  const count = clampInt(payload.count, 1, 20);
  const repeat = clampInt(payload.repeat, 1, 12);
  const modifier = clampInt(payload.modifier || 0, -99, 99);
  const groups = [];
  let grandTotal = 0;

  for (let groupIndex = 0; groupIndex < repeat; groupIndex += 1) {
    const rolls = [];
    let total = 0;
    for (let rollIndex = 0; rollIndex < count; rollIndex += 1) {
      const value = randomInt(1, realSides + 1);
      rolls.push(value);
      total += value;
    }
    const modifiedTotal = total + modifier;
    groups.push({ rolls, total: modifiedTotal, rawTotal: total, modifier });
    grandTotal += modifiedTotal;
  }

  const entry = {
    id: crypto.randomUUID(),
    playerId: actor.id,
    playerName: actor.name,
    playerRole: actor.role,
    playerColor: actor.color,
    sides: realSides,
    count,
    repeat,
    modifier,
    groups,
    grandTotal,
    createdAt: new Date().toISOString()
  };

  room.diceLog.unshift(entry);
  room.diceLog = room.diceLog.slice(0, 50);
  room.activeRoll = { ...entry, seed: randomInt(1, 1000000000), durationMs: 1800 };
}

function characterFromPayload(payload, existing, actor) {
  const data = payload.character || {};
  const stats = data.stats || {};
  const storageMax = clampInt(data.storageMax ?? existing?.storageMax ?? 12, 1, 99);
  return {
    id: existing?.id || data.id || crypto.randomUUID(),
    name: sanitizeText(data.name, 60) || "Personnage sans nom",
    color: sanitizeColor(data.color, existing?.color || "#4e79d8"),
    player: sanitizeText(data.player, 50),
    archetype: sanitizeText(data.archetype, 70),
    level: sanitizeText(data.level, 20),
    pv: sanitizeText(data.pv, 12),
    pvMax: sanitizeText(data.pvMax, 12),
    stamina: sanitizeText(data.stamina, 12),
    staminaMax: sanitizeText(data.staminaMax, 12),
    storage: String(clampInt(data.storage ?? existing?.storage ?? 0, 0, storageMax)),
    storageMax: String(storageMax),
    stats: {
      force: sanitizeStat(stats.force, existing?.stats?.force ?? 10),
      agilite: sanitizeStat(stats.agilite ?? stats.dexterite, existing?.stats?.agilite ?? existing?.stats?.dexterite ?? 10),
      resistance: sanitizeStat(stats.resistance ?? stats.defense, existing?.stats?.resistance ?? existing?.stats?.defense ?? 10),
      perception: sanitizeStat(stats.perception, existing?.stats?.perception ?? 10),
      intelligence: sanitizeStat(stats.intelligence ?? stats.esprit ?? stats.magie, existing?.stats?.intelligence ?? existing?.stats?.esprit ?? existing?.stats?.magie ?? 10),
      charisme: sanitizeStat(stats.charisme ?? stats.social, existing?.stats?.charisme ?? existing?.stats?.social ?? 10)
    },
    equipment: sanitizeLongText(data.equipment, 1400),
    notes: sanitizeLongText(data.notes, 2200),
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy: actor.name
  };
}

function sceneFromPayload(payload, actor) {
  const data = payload.scene || payload || {};
  const mood = SCENE_MOODS.has(String(data.mood)) ? String(data.mood) : "donjon";
  return {
    title: sanitizeText(data.title, 80) || "Scene en cours",
    mood,
    threat: clampInt(data.threat, 0, 6),
    notice: sanitizeLongText(data.notice, 220),
    updatedAt: new Date().toISOString(),
    updatedBy: actor.name
  };
}

function fxFromPayload(payload, actor) {
  const type = TABLE_FX.has(String(payload.type)) ? String(payload.type) : "runes";
  return {
    id: crypto.randomUUID(),
    type,
    actorName: actor.name,
    actorColor: actor.color,
    createdAt: new Date().toISOString()
  };
}

function tokenFromPayload(payload, existing, actor) {
  const data = payload.token || payload;
  const fallbackColor = existing?.color || actor.color || "#e15a4f";
  return {
    id: existing?.id || data.id || crypto.randomUUID(),
    name: sanitizeText(data.name, 36) || "Pion",
    color: sanitizeColor(data.color, fallbackColor),
    x: clamp(data.x, 0.02, 0.98),
    y: clamp(data.y, 0.02, 0.98),
    owner: existing?.owner || actor.name,
    updatedAt: new Date().toISOString()
  };
}

function sanitizeStroke(payload, actor) {
  const data = payload.stroke || {};
  const points = Array.isArray(data.points)
    ? data.points
        .slice(0, 900)
        .map((point) => [clamp(point[0], 0, 1), clamp(point[1], 0, 1)])
        .filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]))
    : [];
  if (points.length < 2) {
    return null;
  }
  return {
    id: crypto.randomUUID(),
    author: actor.name,
    color: sanitizeColor(data.color, "#1f2933"),
    width: clampInt(data.width, 2, 36),
    mode: ["pen", "marker", "erase"].includes(data.mode) ? data.mode : "pen",
    points,
    createdAt: new Date().toISOString()
  };
}

function requireMj(actor, message = "Action reservee au MJ.") {
  if (actor.role !== "MJ") {
    throw new Error(message);
  }
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function saveCurrentDrawing(room, actor, payload) {
  const name = sanitizeText(payload.name, 60) || "Plan " + new Date().toLocaleString("fr-FR");
  const strokes = cloneJson(room.drawings || []);
  const previousVersions = room.savedDrawings
    .filter((drawing) => drawing.name === name)
    .map((drawing) => Number(drawing.version || 1));
  const version = previousVersions.length ? Math.max(...previousVersions) + 1 : 1;
  const entry = {
    id: crypto.randomUUID(),
    name,
    strokes,
    strokeCount: strokes.length,
    version,
    thumbnail: sanitizeThumbnail(payload.thumbnail),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy: actor.name
  };
  room.savedDrawings.unshift(entry);
  room.savedDrawings = room.savedDrawings.slice(0, 30);
  room.activeSavedDrawingId = entry.id;
}

function sanitizeThumbnail(value) {
  const thumbnail = String(value || "");
  if (!thumbnail.startsWith("data:image/") || thumbnail.length > 140000) {
    return "";
  }
  return thumbnail;
}

function loadSavedDrawing(room, payload) {
  const saved = room.savedDrawings.find((drawing) => drawing.id === payload.id);
  if (!saved) {
    throw new Error("Dessin sauvegarde introuvable.");
  }
  room.drawings = cloneJson(saved.strokes || []);
  room.redoDrawings = [];
  room.activeSavedDrawingId = saved.id;
}

function duplicateSavedDrawing(room, actor, payload) {
  const saved = room.savedDrawings.find((drawing) => drawing.id === payload.id);
  if (!saved) {
    throw new Error("Dessin sauvegarde introuvable.");
  }
  const name = sanitizeText(payload.name, 60) || saved.name + " copie";
  const entry = {
    ...cloneJson(saved),
    id: crypto.randomUUID(),
    name,
    version: Number(saved.version || 1) + 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy: actor.name
  };
  room.savedDrawings.unshift(entry);
  room.savedDrawings = room.savedDrawings.slice(0, 30);
}

function setGameClock(room, actor, payload) {
  const current = normalizeGameClock(room.gameClock);
  room.gameClock = {
    ...current,
    day: clampInt(payload.day ?? current.day, 1, 9999),
    time: normalizeClockTime(payload.time ?? current.time),
    weather: sanitizeText(payload.weather ?? current.weather, 40) || current.weather,
    temperature: clampInt(payload.temperature ?? current.temperature, -40, 60),
    noise: normalizeChoice(payload.noise ?? current.noise, ["faible", "moyen", "fort"], current.noise),
    threat: normalizeChoice(payload.threat ?? current.threat, ["basse", "moyenne", "haute", "extreme"], current.threat),
    updatedAt: new Date().toISOString(),
    updatedBy: actor.name
  };
}

function shiftGameClock(room, actor, payload) {
  const delta = clampInt(payload.minutes, -720, 720);
  const [hours, minutes] = normalizeClockTime(room.gameClock?.time).split(":").map(Number);
  const total = ((hours * 60 + minutes + delta) % 1440 + 1440) % 1440;
  room.gameClock = {
    ...normalizeGameClock(room.gameClock),
    time: String(Math.trunc(total / 60)).padStart(2, "0") + ":" + String(total % 60).padStart(2, "0"),
    updatedAt: new Date().toISOString(),
    updatedBy: actor.name
  };
}

function handleAction(room, actor, action, payload) {
  actor.online = true;
  actor.lastSeen = new Date().toISOString();

  switch (action) {
    case "rollDice":
      if (actor.role !== "MJ" && actor.id !== room.activeTurnPlayerId) {
        throw new Error("Le MJ doit t'autoriser a lancer ce de.");
      }
      handleRoll(room, actor, payload);
      if (actor.role !== "MJ") {
        clearTurn(room);
      }
      break;
    case "nextTurn":
      requireMj(actor, "Seul le MJ peut donner le droit de lancer.");
      advanceTurn(room);
      break;
    case "previousTurn":
      requireMj(actor, "Seul le MJ peut revenir au tour precedent.");
      retreatTurn(room);
      break;
    case "setTurn":
      requireMj(actor, "Seul le MJ peut choisir le tour.");
      setTurn(room, payload.playerId);
      break;
    case "clearTurn":
      requireMj(actor, "Seul le MJ peut retirer le droit de lancer.");
      clearTurn(room);
      break;
    case "kickParticipant":
      requireMj(actor, "Seul le MJ peut retirer quelqu'un de la table.");
      kickParticipant(room, actor, payload.playerId);
      break;
    case "saveCharacter": {
      requireMj(actor, "Seul le MJ peut modifier les fiches de personnage.");
      const id = payload.character?.id;
      const index = room.characters.findIndex((character) => character.id === id);
      const existing = index >= 0 ? room.characters[index] : null;
      const character = characterFromPayload(payload, existing, actor);
      if (index >= 0) {
        room.characters[index] = character;
      } else {
        room.characters.unshift(character);
        room.characters = room.characters.slice(0, 40);
      }
      break;
    }
    case "deleteCharacter":
      requireMj(actor, "Seul le MJ peut supprimer les fiches de personnage.");
      room.characters = room.characters.filter((character) => character.id !== payload.id);
      break;
    case "createToken":
      room.tokens.push(tokenFromPayload(payload, null, actor));
      room.tokens = room.tokens.slice(-80);
      break;
    case "updateToken": {
      const id = payload.token?.id || payload.id;
      const index = room.tokens.findIndex((token) => token.id === id);
      if (index >= 0) {
        room.tokens[index] = tokenFromPayload(payload, room.tokens[index], actor);
      }
      break;
    }
    case "deleteToken":
      room.tokens = room.tokens.filter((token) => token.id !== payload.id);
      break;
    case "clearTokens":
      room.tokens = [];
      break;
    case "drawStroke": {
      requireMj(actor, "Seul le MJ peut dessiner sur la carte.");
      const stroke = sanitizeStroke(payload, actor);
      if (stroke) {
        room.drawings.push(stroke);
        room.drawings = room.drawings.slice(-700);
        room.redoDrawings = [];
      }
      break;
    }
    case "clearDrawing":
      requireMj(actor, "Seul le MJ peut effacer le dessin.");
      room.redoDrawings = cloneJson(room.drawings || []).reverse().slice(0, 100);
      room.drawings = [];
      room.activeSavedDrawingId = null;
      break;
    case "undoDrawing": {
      requireMj(actor, "Seul le MJ peut annuler le dessin.");
      const stroke = room.drawings.pop();
      if (stroke) {
        room.redoDrawings.unshift(stroke);
        room.redoDrawings = room.redoDrawings.slice(0, 100);
      }
      break;
    }
    case "redoDrawing": {
      requireMj(actor, "Seul le MJ peut retablir le dessin.");
      const stroke = room.redoDrawings.shift();
      if (stroke) {
        room.drawings.push(stroke);
        room.drawings = room.drawings.slice(-700);
      }
      break;
    }
    case "saveDrawing":
      requireMj(actor, "Seul le MJ peut sauvegarder un dessin.");
      saveCurrentDrawing(room, actor, payload);
      break;
    case "duplicateSavedDrawing":
      requireMj(actor, "Seul le MJ peut dupliquer un dessin sauvegarde.");
      duplicateSavedDrawing(room, actor, payload);
      break;
    case "loadDrawing":
      requireMj(actor, "Seul le MJ peut restaurer un dessin.");
      loadSavedDrawing(room, payload);
      break;
    case "deleteSavedDrawing":
      requireMj(actor, "Seul le MJ peut supprimer un dessin sauvegarde.");
      room.savedDrawings = room.savedDrawings.filter((drawing) => drawing.id !== payload.id);
      if (room.activeSavedDrawingId === payload.id) {
        room.activeSavedDrawingId = null;
      }
      break;
    case "setBoardNotes":
      requireMj(actor, "Seul le MJ peut modifier les notes de scene.");
      room.boardNotes = sanitizeLongText(payload.notes, 2500);
      room.fieldNotes = normalizeFieldNotes({ ...room.fieldNotes, notes: payload.notes }, room.boardNotes);
      break;
    case "setFieldNotes": {
      requireMj(actor, "Seul le MJ peut modifier le carnet de terrain.");
      const tab = String(payload.tab || "notes");
      const allowedTabs = new Set(["notes", "objectives", "clues", "dangers", "secrets"]);
      if (!allowedTabs.has(tab)) {
        throw new Error("Onglet de notes inconnu.");
      }
      room.fieldNotes = normalizeFieldNotes({ ...room.fieldNotes, [tab]: payload.value }, room.boardNotes);
      room.boardNotes = room.fieldNotes.notes;
      break;
    }
    case "setGameClock":
      requireMj(actor, "Seul le MJ peut changer l'heure du JDR.");
      setGameClock(room, actor, payload);
      break;
    case "shiftGameClock":
      requireMj(actor, "Seul le MJ peut changer l'heure du JDR.");
      shiftGameClock(room, actor, payload);
      break;
    case "setScene":
      requireMj(actor, "Seul le MJ peut changer l'ambiance de la table.");
      room.scene = sceneFromPayload(payload, actor);
      break;
    case "triggerFx":
      requireMj(actor, "Seul le MJ peut lancer un effet de table.");
      room.activeFx = fxFromPayload(payload, actor);
      break;
    case "clearDiceLog":
      room.diceLog = [];
      room.activeRoll = null;
      break;
    default:
      throw new Error("Action inconnue");
  }

  touch(room);
}

function randomInt(min, maxExclusive) {
  const range = maxExclusive - min;
  if (range <= 0) {
    return min;
  }
  const max = Math.floor(0xffffffff / range) * range;
  const array = new Uint32Array(1);
  do {
    crypto.getRandomValues(array);
  } while (array[0] >= max);
  return min + (array[0] % range);
}

function randomHex(bytes) {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => value.toString(16).padStart(2, "0")).join("");
}

function hexFromBuffer(buffer) {
  return Array.from(new Uint8Array(buffer), (value) => value.toString(16).padStart(2, "0")).join("");
}

export default worker;
