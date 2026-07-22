const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { URL } = require("node:url");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "rooms.json");
const ACCOUNTS_FILE = path.join(DATA_DIR, "mj-accounts.json");
const TOKEN_COLORS = ["#e15a4f", "#2f9e7e", "#da9a28", "#4e79d8", "#8a65c8", "#2f4858"];
const SCENE_MOODS = new Set(["donjon", "foret", "taverne", "combat", "mystique", "nuit"]);
const TABLE_FX = new Set(["runes", "feu", "eclair", "brume"]);

let rooms = loadRooms();
let accounts = loadAccounts();
let saveTimer = null;
const subscribers = new Map();

function loadRooms() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return {};
    }

    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    for (const room of Object.values(parsed)) {
      for (const player of Object.values(room.participants || {})) {
        player.online = false;
      }
    }
    return parsed;
  } catch (error) {
    console.warn("Impossible de lire les donnees sauvegardees:", error.message);
    return {};
  }
}

function loadAccounts() {
  try {
    if (!fs.existsSync(ACCOUNTS_FILE)) {
      return {};
    }

    const parsed = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    console.warn("Impossible de lire les comptes MJ:", error.message);
    return {};
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(rooms, null, 2));
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
  }, 250);
}

function ensureRoom(roomCode) {
  const code = normalizeRoom(roomCode);
  if (!rooms[code]) {
    rooms[code] = {
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
        weather: "Pluie legere",
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

  normalizeRoomState(rooms[code]);
  return rooms[code];
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

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  return {
    salt,
    hash: crypto.scryptSync(String(password), salt, 32).toString("hex")
  };
}

function verifyPassword(password, account) {
  if (!account?.passwordHash || !account?.passwordSalt) {
    return false;
  }

  const expected = Buffer.from(account.passwordHash, "hex");
  const actual = crypto.scryptSync(String(password), account.passwordSalt, expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function authenticateMjAccount(payload, { createIfMissing = false } = {}) {
  const username = normalizeAccountUsername(payload.username);
  const password = String(payload.password || "");
  const displayName = sanitizeText(payload.displayName, 40);

  if (!username) {
    throw new Error("Choisis un identifiant MJ.");
  }
  if (password.length < 4) {
    throw new Error("Le mot de passe MJ doit faire au moins 4 caracteres.");
  }

  let account = accounts[username];
  if (!account) {
    if (!createIfMissing) {
      throw new Error("Compte MJ introuvable.");
    }

    const passwordData = hashPassword(password);
    account = {
      username,
      displayName: displayName || username,
      passwordSalt: passwordData.salt,
      passwordHash: passwordData.hash,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    accounts[username] = account;
    scheduleSave();
    return account;
  }

  if (!verifyPassword(password, account)) {
    throw new Error("Mot de passe MJ incorrect.");
  }

  if (displayName && account.displayName !== displayName) {
    account.displayName = displayName;
  }
  account.updatedAt = new Date().toISOString();
  scheduleSave();
  return account;
}

function publicMjAccount(account) {
  return {
    username: account.username,
    displayName: account.displayName,
    rooms: roomsForAccount(account.username)
  };
}

function roomsForAccount(username) {
  return Object.values(rooms)
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

function normalizeChoice(value, choices, fallback) {
  const clean = String(value || "").trim().toLowerCase();
  return choices.includes(clean) ? clean : fallback;
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

function normalizeClockTime(value) {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return "08:00";
  }

  const hours = clampInt(match[1], 0, 23);
  const minutes = clampInt(match[2], 0, 59);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
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

function jsonResponse(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Requete trop grande"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
  });
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

function addSubscriber(roomCode, subscriber) {
  if (!subscribers.has(roomCode)) {
    subscribers.set(roomCode, new Set());
  }
  subscribers.get(roomCode).add(subscriber);
}

function removeSubscriber(roomCode, subscriber) {
  const roomSubscribers = subscribers.get(roomCode);
  if (!roomSubscribers) {
    return;
  }

  roomSubscribers.delete(subscriber);
  if (roomSubscribers.size === 0) {
    subscribers.delete(roomCode);
  }
}

function sendEvent(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function broadcast(roomCode) {
  const room = rooms[roomCode];
  const roomSubscribers = subscribers.get(roomCode);
  if (!room || !roomSubscribers) {
    return;
  }

  for (const subscriber of roomSubscribers) {
    const viewer = room.participants?.[subscriber.clientId] || null;
    sendEvent(subscriber.res, "state", publicState(room, viewer));
  }
}

function touch(room) {
  room.updatedAt = new Date().toISOString();
  scheduleSave();
}

function createParticipant(name, role) {
  const id = crypto.randomUUID();
  const color = TOKEN_COLORS[Math.floor(Math.random() * TOKEN_COLORS.length)];
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

function openMjRoom(account, payload) {
  const room = ensureRoom(payload.room);
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
      const value = crypto.randomInt(1, realSides + 1);
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
  room.activeRoll = {
    ...entry,
    seed: crypto.randomInt(1, 1_000_000_000),
    durationMs: 1800
  };
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
  const name = sanitizeText(payload.name, 60) || `Plan ${new Date().toLocaleString("fr-FR")}`;
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
  if (!thumbnail.startsWith("data:image/") || thumbnail.length > 140_000) {
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

  const name = sanitizeText(payload.name, 60) || `${saved.name} copie`;
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
    time: `${String(Math.trunc(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`,
    updatedAt: new Date().toISOString(),
    updatedBy: actor.name
  };
}

function handleAction(room, actor, action, payload) {
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

    case "createToken": {
      room.tokens.push(tokenFromPayload(payload, null, actor));
      room.tokens = room.tokens.slice(-80);
      break;
    }

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

    case "undoDrawing":
      requireMj(actor, "Seul le MJ peut annuler le dessin.");
      {
        const stroke = room.drawings.pop();
        if (stroke) {
          room.redoDrawings.unshift(stroke);
          room.redoDrawings = room.redoDrawings.slice(0, 100);
        }
      }
      break;

    case "redoDrawing": {
      requireMj(actor, "Seul le MJ peut retablir le dessin.");
      const index = 0;
      if (index >= 0 && room.redoDrawings[index]) {
        const [stroke] = room.redoDrawings.splice(index, 1);
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
      room.fieldNotes = normalizeFieldNotes({
        ...room.fieldNotes,
        [tab]: payload.value
      }, room.boardNotes);
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

function serveStatic(req, res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(requested)));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Acces refuse");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end("Introuvable");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentTypes = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8"
    };

    res.writeHead(200, {
      "Content-Type": contentTypes[ext] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  try {
    if (req.method === "POST" && url.pathname === "/api/mj/open") {
      const body = await parseBody(req);
      const account = authenticateMjAccount(body, { createIfMissing: true });
      const { room, participant } = openMjRoom(account, body);
      broadcast(room.code);
      jsonResponse(res, 200, {
        account: publicMjAccount(account),
        session: {
          clientId: participant.id,
          room: room.code,
          name: participant.name,
          role: participant.role,
          account: account.username
        },
        state: publicState(room, participant)
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/mj/rooms") {
      const body = await parseBody(req);
      const account = authenticateMjAccount(body);
      jsonResponse(res, 200, {
        account: publicMjAccount(account)
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/login") {
      const body = await parseBody(req);
      const code = normalizeRoom(body.room);
      const room = rooms[code];
      if (!room) {
        jsonResponse(res, 404, { error: "Salle introuvable. Demande le lien au MJ." });
        return;
      }

      normalizeRoomState(room);
      if (body.role === "MJ") {
        jsonResponse(res, 403, { error: "Le MJ doit passer par son compte." });
        return;
      }

      const participant = addParticipantToRoom(room, body.name, "Joueur");
      touch(room);
      broadcast(room.code);
      jsonResponse(res, 200, {
        session: {
          clientId: participant.id,
          room: room.code,
          name: participant.name,
          role: participant.role
        },
        state: publicState(room, participant)
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/state") {
      const room = ensureRoom(url.searchParams.get("room"));
      const viewer = room.participants[url.searchParams.get("clientId")] || null;
      jsonResponse(res, 200, publicState(room, viewer));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/info") {
      jsonResponse(res, 200, {
        localUrl: `http://localhost:${PORT}`,
        networkUrls: getNetworkUrls(PORT)
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/events") {
      const room = ensureRoom(url.searchParams.get("room"));
      const clientId = url.searchParams.get("clientId");
      const participant = room.participants[clientId];

      if (participant) {
        participant.online = true;
        participant.lastSeen = new Date().toISOString();
        touch(room);
      }

      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no"
      });
      res.write("retry: 1500\n\n");

      const subscriber = { res, clientId };
      addSubscriber(room.code, subscriber);
      sendEvent(res, "state", publicState(room, participant));
      broadcast(room.code);

      const heartbeat = setInterval(() => {
        sendEvent(res, "ping", { time: Date.now() });
      }, 25_000);

      req.on("close", () => {
        clearInterval(heartbeat);
        removeSubscriber(room.code, subscriber);
        if (participant) {
          participant.online = false;
          participant.lastSeen = new Date().toISOString();
          if (room.activeTurnPlayerId === participant.id) {
            clearTurn(room);
          }
          touch(room);
          broadcast(room.code);
        }
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/action") {
      const body = await parseBody(req);
      const room = ensureRoom(body.room);
      const actor = room.participants[body.clientId];

      if (!actor) {
        jsonResponse(res, 401, { error: "Reconnecte-toi avant d'agir." });
        return;
      }

      handleAction(room, actor, body.action, body.payload || {});
      broadcast(room.code);
      jsonResponse(res, 200, { ok: true, state: publicState(room, actor) });
      return;
    }

    if (req.method === "GET") {
      serveStatic(req, res, url.pathname);
      return;
    }

    jsonResponse(res, 405, { error: "Methode non autorisee" });
  } catch (error) {
    jsonResponse(res, 400, { error: error.message || "Erreur" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  const local = `http://localhost:${PORT}`;
  const networkUrls = getNetworkUrls(PORT);
  console.log(`Table JDR lancee: ${local}`);
  for (const address of networkUrls) {
    console.log(`Reseau local: ${address}`);
  }
});

process.on("SIGINT", () => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(rooms, null, 2));
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
  process.exit(0);
});

function getNetworkUrls(port) {
  const urls = [];
  const interfaces = os.networkInterfaces();

  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses || []) {
      if (address.family === "IPv4" && !address.internal) {
        urls.push(`http://${address.address}:${port}`);
      }
    }
  }

  return urls;
}
