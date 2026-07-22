const diceTypes = [2, 3, 4, 6, 8, 10, 20, 100];
const characterStatDefinitions = [
  { key: "force", label: "Force" },
  { key: "agilite", label: "Agilite", legacy: ["dexterite"] },
  { key: "resistance", label: "Resistance", legacy: ["defense"] },
  { key: "perception", label: "Perception" },
  { key: "intelligence", label: "Intelligence", legacy: ["esprit", "magie"] },
  { key: "charisme", label: "Charisme", legacy: ["social"] }
];

let session = readStoredJson("jdr-session");
let mjAccount = readStoredJson("jdr-mj-account");
let state = null;
let eventSource = null;
let selectedDie = 20;
let customDiceTypes = sanitizeCustomDice(readStoredJson("jdr-custom-dice"));
let drawingMode = "pen";
let isDrawing = false;
let currentStroke = null;
let isDraggingToken = false;
let lastAnimatedRollId = null;
let rollRevealTimer = null;
let lastFxId = null;
let fxClearTimer = null;
let lastTurnId = undefined;
let turnToastTimer = null;
let serverInfo = { localUrl: window.location.origin, networkUrls: [] };
let mapZoom = 1;
let activeNoteTab = "notes";
let collapsedCharacters = readStoredJson("jdr-collapsed-characters") || {};
let autoSaveDrawing = localStorage.getItem("jdr-auto-save-drawing") === "true";
let lastDiceConfig = readStoredJson("jdr-last-dice-config") || null;

function readStoredJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch (error) {
    localStorage.removeItem(key);
    return null;
  }
}

function sanitizeCustomDice(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return [...new Set(values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .map((value) => Math.trunc(clamp(value, 2, 1000))))]
    .filter((value) => !diceTypes.includes(value))
    .sort((a, b) => a - b)
    .slice(0, 16);
}

const elements = {
  loginScreen: document.querySelector("#loginScreen"),
  loginForm: document.querySelector("#loginForm"),
  loginName: document.querySelector("#loginName"),
  loginRoom: document.querySelector("#loginRoom"),
  loginInviteLink: document.querySelector("#loginInviteLink"),
  createRoomButton: document.querySelector("#createRoomButton"),
  copyLoginInviteButton: document.querySelector("#copyLoginInviteButton"),
  resumeSessionCard: document.querySelector("#resumeSessionCard"),
  resumeSessionLabel: document.querySelector("#resumeSessionLabel"),
  resumeSessionButton: document.querySelector("#resumeSessionButton"),
  clearResumeSessionButton: document.querySelector("#clearResumeSessionButton"),
  mjAccountForm: document.querySelector("#mjAccountForm"),
  mjDisplayName: document.querySelector("#mjDisplayName"),
  mjUsername: document.querySelector("#mjUsername"),
  mjPassword: document.querySelector("#mjPassword"),
  mjRoom: document.querySelector("#mjRoom"),
  loadMjRoomsButton: document.querySelector("#loadMjRoomsButton"),
  mjAccountStatus: document.querySelector("#mjAccountStatus"),
  mjRoomsList: document.querySelector("#mjRoomsList"),
  app: document.querySelector("#app"),
  toggleLeftColumnButton: document.querySelector("#toggleLeftColumnButton"),
  toggleRightColumnButton: document.querySelector("#toggleRightColumnButton"),
  roomLabel: document.querySelector("#roomLabel"),
  roomCodeDisplay: document.querySelector("#roomCodeDisplay"),
  inviteLink: document.querySelector("#inviteLink"),
  copyInviteButton: document.querySelector("#copyInviteButton"),
  networkLinks: document.querySelector("#networkLinks"),
  turnAvatar: document.querySelector("#turnAvatar"),
  turnLabel: document.querySelector("#turnLabel"),
  sessionAvatar: document.querySelector("#sessionAvatar"),
  sessionLabel: document.querySelector("#sessionLabel"),
  logoutButton: document.querySelector("#logoutButton"),
  statusDot: document.querySelector("#statusDot"),
  tableFxLayer: document.querySelector("#tableFxLayer"),
  turnToast: document.querySelector("#turnToast"),
  turnToastAvatar: document.querySelector("#turnToastAvatar"),
  turnToastText: document.querySelector("#turnToastText"),
  sceneTitleLabel: document.querySelector("#sceneTitleLabel"),
  sceneMoodLabel: document.querySelector("#sceneMoodLabel"),
  threatDots: document.querySelector("#threatDots"),
  sceneNotice: document.querySelector("#sceneNotice"),
  gameClockDisplay: document.querySelector("#gameClockDisplay"),
  gameClockMoment: document.querySelector("#gameClockMoment"),
  gameClockWeather: document.querySelector("#gameClockWeather"),
  gameClockRisk: document.querySelector("#gameClockRisk"),
  gameClockControls: document.querySelector("#gameClockControls"),
  gameDayInput: document.querySelector("#gameDayInput"),
  gameClockInput: document.querySelector("#gameClockInput"),
  gameWeatherInput: document.querySelector("#gameWeatherInput"),
  gameTemperatureInput: document.querySelector("#gameTemperatureInput"),
  gameNoiseInput: document.querySelector("#gameNoiseInput"),
  gameThreatInput: document.querySelector("#gameThreatInput"),
  clockMinusButton: document.querySelector("#clockMinusButton"),
  clockPlusButton: document.querySelector("#clockPlusButton"),
  clockHourButton: document.querySelector("#clockHourButton"),
  sceneForm: document.querySelector("#sceneForm"),
  sceneTitleInput: document.querySelector("#sceneTitleInput"),
  sceneMoodInput: document.querySelector("#sceneMoodInput"),
  sceneThreatInput: document.querySelector("#sceneThreatInput"),
  sceneThreatValue: document.querySelector("#sceneThreatValue"),
  sceneNoticeInput: document.querySelector("#sceneNoticeInput"),
  saveSceneButton: document.querySelector("#saveSceneButton"),
  clearNoticeButton: document.querySelector("#clearNoticeButton"),
  scenePresetButtons: Array.from(document.querySelectorAll("[data-scene-preset]")),
  fxButtons: Array.from(document.querySelectorAll("[data-fx]")),
  drawView: document.querySelector("#drawView"),
  playerCount: document.querySelector("#playerCount"),
  playerList: document.querySelector("#playerList"),
  characterList: document.querySelector("#characterList"),
  newCharacterButton: document.querySelector("#newCharacterButton"),
  sheetEditorCard: document.querySelector("#sheetEditorCard"),
  sheetEditorTitle: document.querySelector("#sheetEditorTitle"),
  characterPermissionNote: document.querySelector("#characterPermissionNote"),
  closeCharacterEditor: document.querySelector("#closeCharacterEditor"),
  diceGrid: document.querySelector("#diceGrid"),
  diceSelect: document.querySelector("#diceSelect"),
  customDieForm: document.querySelector("#customDieForm"),
  customDieSides: document.querySelector("#customDieSides"),
  addCustomDieButton: document.querySelector("#addCustomDieButton"),
  diceCount: document.querySelector("#diceCount"),
  diceModifier: document.querySelector("#diceModifier"),
  diceRepeat: document.querySelector("#diceRepeat"),
  rollButton: document.querySelector("#rollButton"),
  rerollButton: document.querySelector("#rerollButton"),
  prevTurnButton: document.querySelector("#prevTurnButton"),
  nextTurnButton: document.querySelector("#nextTurnButton"),
  topDiceTerminal: document.querySelector("#topDiceTerminal"),
  diceLog: document.querySelector("#diceLog"),
  clearDiceButton: document.querySelector("#clearDiceButton"),
  diceAnimationArea: document.querySelector("#diceAnimationArea"),
  diceStage: document.querySelector("#diceStage"),
  rollerAvatar: document.querySelector("#rollerAvatar"),
  rollerText: document.querySelector("#rollerText"),
  rollResult: document.querySelector("#rollResult"),
  tokenForm: document.querySelector("#tokenForm"),
  tokenName: document.querySelector("#tokenName"),
  tokenColor: document.querySelector("#tokenColor"),
  tokenLayer: document.querySelector("#tokenLayer"),
  battleMap: document.querySelector("#battleMap"),
  clearTokensButton: document.querySelector("#clearTokensButton"),
  boardNotes: document.querySelector("#boardNotes"),
  drawCanvas: document.querySelector("#drawCanvas"),
  penTool: document.querySelector("#penTool"),
  markerTool: document.querySelector("#markerTool"),
  eraseTool: document.querySelector("#eraseTool"),
  eyedropperTool: document.querySelector("#eyedropperTool"),
  colorSwatches: document.querySelector("#colorSwatches"),
  currentColorPreview: document.querySelector("#currentColorPreview"),
  drawColor: document.querySelector("#drawColor"),
  drawSize: document.querySelector("#drawSize"),
  undoDrawingButton: document.querySelector("#undoDrawingButton"),
  redoDrawingButton: document.querySelector("#redoDrawingButton"),
  clearDrawingButton: document.querySelector("#clearDrawingButton"),
  zoomOutButton: document.querySelector("#zoomOutButton"),
  zoomResetButton: document.querySelector("#zoomResetButton"),
  zoomInButton: document.querySelector("#zoomInButton"),
  centerMapButton: document.querySelector("#centerMapButton"),
  fullscreenMapButton: document.querySelector("#fullscreenMapButton"),
  savedDrawingName: document.querySelector("#savedDrawingName"),
  saveDrawingButton: document.querySelector("#saveDrawingButton"),
  savedDrawingSelect: document.querySelector("#savedDrawingSelect"),
  savedDrawingList: document.querySelector("#savedDrawingList"),
  loadDrawingButton: document.querySelector("#loadDrawingButton"),
  duplicateSavedDrawingButton: document.querySelector("#duplicateSavedDrawingButton"),
  deleteSavedDrawingButton: document.querySelector("#deleteSavedDrawingButton"),
  autoSaveDrawingToggle: document.querySelector("#autoSaveDrawingToggle"),
  characterDetailsPanel: document.querySelector("#characterDetailsPanel"),
  noteTabs: document.querySelector("#noteTabs"),
  activeNoteLabel: document.querySelector("#activeNoteLabel"),
  quickNoteButton: document.querySelector("#quickNoteButton"),
  characterForm: document.querySelector("#characterForm"),
  saveCharacterButton: document.querySelector("#saveCharacterButton"),
  resetCharacterForm: document.querySelector("#resetCharacterForm"),
  characterId: document.querySelector("#characterId"),
  characterName: document.querySelector("#characterName"),
  characterPlayer: document.querySelector("#characterPlayer"),
  characterArchetype: document.querySelector("#characterArchetype"),
  characterLevel: document.querySelector("#characterLevel"),
  characterPv: document.querySelector("#characterPv"),
  characterPvMax: document.querySelector("#characterPvMax"),
  characterStamina: document.querySelector("#characterStamina"),
  characterStaminaMax: document.querySelector("#characterStaminaMax"),
  statForce: document.querySelector("#statForce"),
  statAgilite: document.querySelector("#statAgilite"),
  statResistance: document.querySelector("#statResistance"),
  statPerception: document.querySelector("#statPerception"),
  statIntelligence: document.querySelector("#statIntelligence"),
  statCharisme: document.querySelector("#statCharisme"),
  characterEquipment: document.querySelector("#characterEquipment"),
  characterNotes: document.querySelector("#characterNotes")
};

bootstrap();

function bootstrap() {
  forceSiteTitle();
  applyRoomFromUrl();
  restoreMjLobbyAccount();
  loadServerInfo();
  refreshLoginInvite();
  renderLobbyResume();
  elements.sheetEditorCard.classList.add("closed");
  buildDiceButtons();
  bindEvents();
  updateSceneThreatValue();
  setCurrentColor(elements.drawColor.value);
  elements.drawView.style.setProperty("--map-zoom", mapZoom);
  elements.autoSaveDrawingToggle.checked = autoSaveDrawing;
  renderIdleDice();
}

function forceSiteTitle() {
  document.title = "JDR";
  document.querySelectorAll(".login-panel > h1, .brand-panel h1").forEach((title) => {
    title.textContent = "JDR";
  });
}

function bindEvents() {
  elements.loginRoom.addEventListener("input", refreshLoginInvite);
  elements.loginRoom.addEventListener("blur", () => {
    elements.loginRoom.value = sanitizeRoomClient(elements.loginRoom.value) || "TABLE-1";
    refreshLoginInvite();
  });

  elements.mjRoom.addEventListener("blur", () => {
    elements.mjRoom.value = sanitizeRoomClient(elements.mjRoom.value) || randomRoomCode();
    elements.loginRoom.value = elements.mjRoom.value;
    refreshLoginInvite();
  });
  elements.mjRoom.addEventListener("input", () => {
    elements.loginRoom.value = sanitizeRoomClient(elements.mjRoom.value);
    refreshLoginInvite();
  });

  elements.createRoomButton.addEventListener("click", () => {
    elements.mjRoom.value = randomRoomCode();
    elements.loginRoom.value = elements.mjRoom.value;
    refreshLoginInvite();
    elements.mjDisplayName.focus();
  });

  elements.resumeSessionButton.addEventListener("click", () => {
    if (!session?.clientId || !session?.room) {
      return;
    }
    enterApp();
    connectEvents();
  });

  elements.clearResumeSessionButton.addEventListener("click", () => {
    session = null;
    localStorage.removeItem("jdr-session");
    renderLobbyResume();
  });

  elements.copyLoginInviteButton.addEventListener("click", () => {
    copyText(elements.loginInviteLink.value, elements.copyLoginInviteButton);
  });

  elements.copyInviteButton.addEventListener("click", () => {
    copyText(elements.inviteLink.value, elements.copyInviteButton);
  });

  elements.mjAccountForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await openMjTable(elements.mjRoom.value);
  });

  elements.loadMjRoomsButton.addEventListener("click", async () => {
    await loadMjRooms();
  });

  elements.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    elements.loginRoom.value = sanitizeRoomClient(elements.loginRoom.value) || "TABLE-1";
    const formData = new FormData(elements.loginForm);

    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: formData.get("name"),
        room: formData.get("room"),
        role: formData.get("role")
      })
    });

    const payload = await response.json();
    if (!response.ok) {
      alert(payload.error || "Connexion impossible");
      return;
    }

    finishLobbyLogin(payload);
  });

  elements.logoutButton.addEventListener("click", () => {
    if (eventSource) {
      eventSource.close();
    }
    session = null;
    state = null;
    localStorage.removeItem("jdr-session");
    elements.statusDot.classList.remove("online");
    elements.app.hidden = true;
    elements.loginScreen.hidden = false;
    renderLobbyResume();
    elements.loginName.focus();
  });

  elements.rollButton.addEventListener("click", () => {
    if (!canRollNow()) {
      alert("Le MJ doit t'autoriser a lancer ce de.");
      return;
    }

    rollWithConfig({
      sides: selectedDie,
      count: elements.diceCount.value,
      repeat: elements.diceRepeat.value,
      modifier: elements.diceModifier.value
    });
  });

  elements.rerollButton.addEventListener("click", () => {
    const config = lastDiceConfig || state?.activeRoll || { sides: selectedDie, count: elements.diceCount.value, repeat: elements.diceRepeat.value, modifier: elements.diceModifier.value };
    selectedDie = Number(config.sides || selectedDie);
    elements.diceCount.value = config.count || 1;
    elements.diceRepeat.value = config.repeat || 1;
    elements.diceModifier.value = config.modifier || 0;
    buildDiceButtons();
    rollWithConfig(config);
  });

  elements.diceSelect.addEventListener("change", () => {
    selectedDie = Number(elements.diceSelect.value || selectedDie);
    buildDiceButtons();
  });

  elements.customDieForm.addEventListener("submit", (event) => {
    event.preventDefault();
    addCustomDie();
  });

  elements.nextTurnButton.addEventListener("click", () => {
    action("nextTurn", {});
  });

  elements.prevTurnButton.addEventListener("click", () => {
    action("previousTurn", {});
  });

  elements.clearDiceButton.addEventListener("click", () => {
    action("clearDiceLog", {});
  });

  if (elements.tokenForm) {
    elements.tokenForm.addEventListener("submit", (event) => {
      event.preventDefault();
    });
  }

  if (elements.clearTokensButton) {
    elements.clearTokensButton.addEventListener("click", () => {
      action("clearTokens", {});
    });
  }

  elements.boardNotes.addEventListener(
    "input",
    debounce(() => {
      if (!isMj()) {
        return;
      }
      action("setFieldNotes", { tab: activeNoteTab, value: elements.boardNotes.value });
    }, 500)
  );

  [
    elements.gameDayInput,
    elements.gameClockInput,
    elements.gameWeatherInput,
    elements.gameTemperatureInput,
    elements.gameNoiseInput,
    elements.gameThreatInput
  ].forEach((control) => {
    control.addEventListener("change", updateGameClockFromFields);
  });

  elements.clockMinusButton.addEventListener("click", () => {
    action("shiftGameClock", { minutes: -10 });
  });

  elements.clockPlusButton.addEventListener("click", () => {
    action("shiftGameClock", { minutes: 10 });
  });

  elements.clockHourButton.addEventListener("click", () => {
    action("shiftGameClock", { minutes: 60 });
  });

  if (elements.sceneForm) {
    elements.sceneForm.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!isMj()) {
        alert("Seul le MJ peut changer l'ambiance.");
        return;
      }
      applySceneFromFields();
    });
  }

  if (elements.sceneThreatInput) {
    elements.sceneThreatInput.addEventListener("input", updateSceneThreatValue);
  }

  if (elements.clearNoticeButton && elements.sceneNoticeInput) {
    elements.clearNoticeButton.addEventListener("click", () => {
      if (!isMj()) {
        alert("Seul le MJ peut retirer une annonce.");
        return;
      }
      elements.sceneNoticeInput.value = "";
      applySceneFromFields();
    });
  }

  elements.scenePresetButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (!isMj()) {
        alert("Seul le MJ peut appliquer un preset.");
        return;
      }
      applyScenePreset(button.dataset.scenePreset);
    });
  });

  elements.fxButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (!isMj()) {
        alert("Seul le MJ peut lancer un effet de table.");
        return;
      }
      action("triggerFx", { type: button.dataset.fx });
    });
  });

  elements.penTool.addEventListener("click", () => setDrawingMode("pen"));
  elements.markerTool.addEventListener("click", () => setDrawingMode("marker"));
  elements.eraseTool.addEventListener("click", () => setDrawingMode("erase"));
  elements.eyedropperTool.addEventListener("click", () => setDrawingMode("eyedropper"));

  elements.colorSwatches.querySelectorAll("[data-color]").forEach((button) => {
    button.addEventListener("click", () => {
      setCurrentColor(button.dataset.color);
      setDrawingMode("pen");
    });
  });

  elements.drawColor.addEventListener("input", () => {
    setCurrentColor(elements.drawColor.value);
    setDrawingMode("pen");
  });

  elements.clearDrawingButton.addEventListener("click", () => {
    if (!isMj()) {
      alert("Seul le MJ peut effacer le dessin.");
      return;
    }
    action("clearDrawing", {});
  });

  elements.undoDrawingButton.addEventListener("click", () => {
    action("undoDrawing", {});
  });

  elements.redoDrawingButton.addEventListener("click", () => {
    action("redoDrawing", {});
  });

  elements.zoomOutButton.addEventListener("click", () => setMapZoom(mapZoom - 0.15));
  elements.zoomInButton.addEventListener("click", () => setMapZoom(mapZoom + 0.15));
  elements.zoomResetButton.addEventListener("click", () => setMapZoom(1));
  elements.centerMapButton.addEventListener("click", centerMap);
  elements.fullscreenMapButton.addEventListener("click", toggleMapFullscreen);
  elements.toggleLeftColumnButton.addEventListener("click", () => elements.app.classList.toggle("hide-left"));
  elements.toggleRightColumnButton.addEventListener("click", () => elements.app.classList.toggle("hide-right"));

  elements.saveDrawingButton.addEventListener("click", () => {
    if (!isMj()) {
      alert("Seul le MJ peut sauvegarder un dessin.");
      return;
    }
    action("saveDrawing", { name: elements.savedDrawingName.value, thumbnail: drawingThumbnail() });
    elements.savedDrawingName.value = "";
  });

  elements.loadDrawingButton.addEventListener("click", () => {
    if (!isMj()) {
      alert("Seul le MJ peut restaurer un dessin.");
      return;
    }
    const id = elements.savedDrawingSelect.value;
    if (id) {
      action("loadDrawing", { id });
    }
  });

  elements.deleteSavedDrawingButton.addEventListener("click", () => {
    if (!isMj()) {
      alert("Seul le MJ peut supprimer un dessin sauvegarde.");
      return;
    }
    const id = elements.savedDrawingSelect.value;
    if (id && confirm("Supprimer cette sauvegarde de plan ?")) {
      action("deleteSavedDrawing", { id });
    }
  });

  elements.duplicateSavedDrawingButton.addEventListener("click", () => {
    if (!isMj()) {
      alert("Seul le MJ peut dupliquer un plan sauvegarde.");
      return;
    }
    const id = elements.savedDrawingSelect.value;
    if (id) {
      action("duplicateSavedDrawing", { id });
    }
  });

  elements.autoSaveDrawingToggle.addEventListener("change", () => {
    autoSaveDrawing = elements.autoSaveDrawingToggle.checked;
    localStorage.setItem("jdr-auto-save-drawing", String(autoSaveDrawing));
  });

  elements.noteTabs.querySelectorAll("[data-note-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      activeNoteTab = button.dataset.noteTab;
      renderFieldNotes();
    });
  });

  elements.quickNoteButton.addEventListener("click", () => {
    if (!isMj()) {
      alert("Seul le MJ peut ajouter une note rapide.");
      return;
    }
    const prefix = activeNoteTab === "objectives" ? "[ ] Nouvel objectif" : activeNoteTab === "dangers" ? "- Danger: " : "- Note: ";
    elements.boardNotes.value = `${elements.boardNotes.value.trim()}\n${prefix}`.trimStart();
    action("setFieldNotes", { tab: activeNoteTab, value: elements.boardNotes.value });
    elements.boardNotes.focus();
  });

  elements.drawCanvas.addEventListener("pointerdown", startDrawing);
  elements.drawCanvas.addEventListener("pointermove", continueDrawing);
  elements.drawCanvas.addEventListener("pointerup", finishDrawing);
  elements.drawCanvas.addEventListener("pointerleave", finishDrawing);

  elements.characterForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveCharacter();
  });

  elements.resetCharacterForm.addEventListener("click", () => {
    if (!isMj()) {
      return;
    }
    clearCharacterForm();
    openCharacterEditor();
  });

  elements.newCharacterButton.addEventListener("click", () => {
    if (!isMj()) {
      alert("Seul le MJ peut creer ou modifier les fiches.");
      return;
    }
    clearCharacterForm();
    openCharacterEditor();
  });

  elements.closeCharacterEditor.addEventListener("click", () => {
    elements.sheetEditorCard.classList.add("closed");
  });
}

function restoreMjLobbyAccount() {
  if (mjAccount?.username) {
    elements.mjUsername.value = mjAccount.username;
  }
  if (mjAccount?.displayName) {
    elements.mjDisplayName.value = mjAccount.displayName;
  }
}

function renderLobbyResume() {
  if (!session?.clientId || !session?.room) {
    elements.resumeSessionCard.hidden = true;
    return;
  }

  elements.resumeSessionLabel.textContent = `${session.room} - ${session.name} (${session.role})`;
  elements.resumeSessionCard.hidden = false;
}

function mjLobbyPayload(room = elements.mjRoom.value) {
  const cleanRoom = sanitizeRoomClient(room) || randomRoomCode();
  elements.mjRoom.value = cleanRoom;
  elements.loginRoom.value = cleanRoom;
  refreshLoginInvite();

  return {
    displayName: elements.mjDisplayName.value,
    username: elements.mjUsername.value,
    password: elements.mjPassword.value,
    room: cleanRoom
  };
}

async function openMjTable(room) {
  setMjLobbyStatus("Ouverture de la table...");
  const response = await fetch("/api/mj/open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(mjLobbyPayload(room))
  });

  const payload = await response.json();
  if (!response.ok) {
    setMjLobbyStatus(payload.error || "Impossible d'ouvrir la table.");
    return;
  }

  finishLobbyLogin(payload);
}

async function loadMjRooms() {
  setMjLobbyStatus("Verification du compte MJ...");
  const response = await fetch("/api/mj/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      displayName: elements.mjDisplayName.value,
      username: elements.mjUsername.value,
      password: elements.mjPassword.value
    })
  });

  const payload = await response.json();
  if (!response.ok) {
    setMjLobbyStatus(payload.error || "Impossible de charger les tables.");
    return;
  }

  mjAccount = payload.account;
  localStorage.setItem("jdr-mj-account", JSON.stringify({
    username: mjAccount.username,
    displayName: mjAccount.displayName
  }));
  renderMjRooms(mjAccount.rooms || []);
  setMjLobbyStatus((mjAccount.rooms || []).length ? "Tables sauvegardees chargees." : "Aucune table sauvegardee pour ce compte.");
}

function renderMjRooms(rooms) {
  if (!rooms.length) {
    elements.mjRoomsList.innerHTML = `<div class="empty-state">Aucune table sauvegardee.</div>`;
    return;
  }

  elements.mjRoomsList.innerHTML = rooms
    .map((room) => `
      <article class="saved-room-row">
        <div>
          <strong>${escapeHtml(room.code)}</strong>
          <span>${escapeHtml(savedRoomMeta(room))}</span>
        </div>
        <button class="mini-button" data-open-mj-room="${escapeHtml(room.code)}" type="button">Ouvrir</button>
      </article>
    `)
    .join("");

  elements.mjRoomsList.querySelectorAll("[data-open-mj-room]").forEach((button) => {
    button.addEventListener("click", () => {
      elements.mjRoom.value = button.dataset.openMjRoom;
      openMjTable(button.dataset.openMjRoom);
    });
  });
}

function savedRoomMeta(room) {
  const bits = [
    `${room.players || 0} joueur${room.players > 1 ? "s" : ""}`,
    `${room.characters || 0} fiche${room.characters > 1 ? "s" : ""}`,
    `${room.savedDrawings || 0} plan${room.savedDrawings > 1 ? "s" : ""}`
  ];
  return bits.join(" - ");
}

function setMjLobbyStatus(message) {
  elements.mjAccountStatus.textContent = message;
}

function finishLobbyLogin(payload) {
  session = payload.session;
  state = payload.state;
  mjAccount = payload.account || mjAccount;
  elements.mjPassword.value = "";

  localStorage.setItem("jdr-session", JSON.stringify(session));
  if (mjAccount?.username) {
    localStorage.setItem("jdr-mj-account", JSON.stringify({
      username: mjAccount.username,
      displayName: mjAccount.displayName
    }));
  }

  lastAnimatedRollId = state.activeRoll?.id || null;
  updateRoomInUrl(session.room);
  renderLobbyResume();
  enterApp();
  connectEvents();
  render();
}

function enterApp() {
  elements.loginScreen.hidden = true;
  elements.app.hidden = false;
  elements.roomLabel.textContent = session.room;
  elements.roomCodeDisplay.textContent = session.room;
  elements.sessionLabel.textContent = `${session.name} - ${session.role}`;
  setAvatar(elements.sessionAvatar, session.name, currentPlayer()?.color);
  refreshInvitePanel();
}

function connectEvents() {
  if (eventSource) {
    eventSource.close();
  }

  eventSource = new EventSource(`/api/events?room=${encodeURIComponent(session.room)}&clientId=${encodeURIComponent(session.clientId)}`);
  eventSource.addEventListener("open", () => {
    elements.statusDot.classList.add("online");
  });
  eventSource.addEventListener("error", () => {
    elements.statusDot.classList.remove("online");
  });
  eventSource.addEventListener("state", (event) => {
    const incomingState = JSON.parse(event.data);
    if (session?.clientId && !incomingState.participants?.some((player) => player.id === session.clientId)) {
      handleSessionRemoved();
      return;
    }
    state = incomingState;
    render();
  });
}

function handleSessionRemoved() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }

  session = null;
  state = null;
  localStorage.removeItem("jdr-session");
  elements.statusDot.classList.remove("online");
  elements.app.hidden = true;
  elements.loginScreen.hidden = false;
  renderLobbyResume();
  alert("Tu n'es plus dans cette table. Retour au lobby.");
}

async function action(actionName, payload) {
  if (!session) {
    return;
  }

  try {
    const response = await fetch("/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        room: session.room,
        clientId: session.clientId,
        action: actionName,
        payload
      })
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      alert(body.error || "Action impossible");
      return;
    }

    if (body.state) {
      state = body.state;
      render();
    }
  } catch (error) {
    alert("Connexion au serveur perdue. Recharge la page si besoin.");
  }
}

function render() {
  if (!state) {
    return;
  }

  elements.roomLabel.textContent = state.code;
  elements.roomCodeDisplay.textContent = state.code;
  elements.sessionLabel.textContent = `${session.name} - ${session.role}`;
  setAvatar(elements.sessionAvatar, session.name, currentPlayer()?.color);
  refreshInvitePanel();
  renderScene();
  renderGameClock();
  renderTurn();
  renderPermissions();
  renderPlayers();
  renderCharacters();
  renderCharacterDetails();
  renderSavedDrawings();
  renderDiceLog();
  renderTokens();
  renderDrawing();
  renderFieldNotes();
  maybePlayRollAnimation();
  renderActiveFx();
}

function renderTurn() {
  if (!state.turn) {
    elements.turnLabel.textContent = "MJ en attente";
    setAvatar(elements.turnAvatar, "?", "#69746d");
    lastTurnId = "";
    return;
  }

  elements.turnLabel.textContent = state.turn.name;
  setAvatar(elements.turnAvatar, state.turn.name, state.turn.color);

  if (lastTurnId === undefined) {
    lastTurnId = state.turn.id;
    return;
  }

  if (state.turn.id && state.turn.id !== lastTurnId) {
    showTurnToast(state.turn);
    lastTurnId = state.turn.id;
  }
}

function showTurnToast(turn) {
  clearTimeout(turnToastTimer);
  setAvatar(elements.turnToastAvatar, turn.name, turn.color);
  elements.turnToastText.textContent = `${turn.name} peut lancer`;
  elements.turnToast.hidden = false;
  elements.turnToast.classList.remove("show");
  void elements.turnToast.offsetWidth;
  elements.turnToast.classList.add("show");
  turnToastTimer = setTimeout(() => {
    elements.turnToast.hidden = true;
    elements.turnToast.classList.remove("show");
  }, 1800);
}

function renderGameClock() {
  const clock = state.gameClock || {};
  const time = normalizeClockTimeClient(clock.time);
  const day = clamp(Number(clock.day || 1), 1, 9999);
  const weather = clock.weather || "Temps couvert";
  const temperature = Number.isFinite(Number(clock.temperature)) ? Number(clock.temperature) : 8;
  const noise = clock.noise || "faible";
  const threat = clock.threat || "moyenne";

  elements.gameClockDisplay.textContent = time;
  elements.gameClockWeather.textContent = `${weather} - ${temperature}C`;
  elements.gameClockMoment.textContent = clockMomentLabel(time);
  elements.gameClockRisk.textContent = `Bruit ${noise} - Menace ${threat}`;
  syncField(elements.gameDayInput, day);
  syncField(elements.gameClockInput, time);
  syncField(elements.gameWeatherInput, weather);
  syncField(elements.gameTemperatureInput, temperature);
  syncField(elements.gameNoiseInput, noise);
  syncField(elements.gameThreatInput, threat);
}

function renderFieldNotes() {
  const notes = state.fieldNotes || { notes: state.boardNotes || "" };
  if (!isMj() && activeNoteTab === "secrets") {
    activeNoteTab = "notes";
  }

  elements.noteTabs.querySelectorAll("[data-note-tab]").forEach((button) => {
    const isSecret = button.dataset.noteTab === "secrets";
    button.hidden = isSecret && !isMj();
    button.classList.toggle("active", button.dataset.noteTab === activeNoteTab);
  });

  const labels = {
    notes: "Notes",
    objectives: "Objectifs",
    clues: "Indices",
    dangers: "Dangers",
    secrets: "Secrets MJ"
  };
  elements.activeNoteLabel.textContent = labels[activeNoteTab] || "Notes";

  const value = notes[activeNoteTab] || "";
  if (document.activeElement !== elements.boardNotes) {
    elements.boardNotes.value = value;
  }
  elements.boardNotes.classList.toggle("secret-note", activeNoteTab === "secrets");
}

function renderPermissions() {
  const mj = isMj();
  const canRoll = canRollNow();

  elements.newCharacterButton.disabled = !mj;
  elements.saveCharacterButton.hidden = !mj;
  elements.resetCharacterForm.hidden = !mj;
  elements.prevTurnButton.disabled = !mj;
  elements.nextTurnButton.disabled = !mj;
  elements.rollButton.disabled = !canRoll;
  elements.rerollButton.disabled = !canRoll;
  elements.rollButton.textContent = canRoll ? (mj ? "Lancer MJ" : "Lancer une fois") : "Attend MJ";
  elements.gameClockControls.hidden = !mj;
  elements.drawView.classList.toggle("drawing-locked", !mj);
  elements.drawCanvas.setAttribute("aria-disabled", String(!mj));

  setCharacterFormReadonly(!mj);
  setMjControlsReadonly(!mj);
  elements.characterPermissionNote.textContent = mj
    ? "Mode MJ: tu peux creer et modifier les fiches."
    : "Lecture seule: seul le MJ peut modifier les fiches.";
}

function setMjControlsReadonly(readonly) {
  [
    elements.clearDrawingButton,
    elements.penTool,
    elements.markerTool,
    elements.eraseTool,
    elements.eyedropperTool,
    elements.drawColor,
    elements.drawSize,
    elements.undoDrawingButton,
    elements.redoDrawingButton,
    elements.savedDrawingName,
    elements.saveDrawingButton,
    elements.savedDrawingSelect,
    elements.loadDrawingButton,
    elements.duplicateSavedDrawingButton,
    elements.deleteSavedDrawingButton,
    elements.autoSaveDrawingToggle,
    elements.boardNotes,
    elements.quickNoteButton,
    ...Array.from(elements.noteTabs.querySelectorAll("[data-note-tab]")).filter((button) => button.dataset.noteTab === "secrets"),
    elements.gameDayInput,
    elements.gameClockInput,
    elements.gameWeatherInput,
    elements.gameTemperatureInput,
    elements.gameNoiseInput,
    elements.gameThreatInput,
    elements.clockMinusButton,
    elements.clockPlusButton,
    elements.clockHourButton,
    elements.sceneTitleInput,
    elements.sceneMoodInput,
    elements.sceneThreatInput,
    elements.sceneNoticeInput,
    elements.saveSceneButton,
    elements.clearNoticeButton,
    ...elements.scenePresetButtons,
    ...elements.fxButtons,
    ...Array.from(elements.colorSwatches.querySelectorAll("[data-color]"))
  ].forEach((control) => {
    if (control) {
      control.disabled = readonly;
    }
  });
}

function rollWithConfig(config) {
  if (!canRollNow()) {
    alert("Le MJ doit t'autoriser a lancer ce de.");
    return;
  }

  const cleanConfig = {
    sides: Number(config.sides || selectedDie),
    count: Number(config.count || 1),
    repeat: Number(config.repeat || 1),
    modifier: Number(config.modifier || 0)
  };
  lastDiceConfig = cleanConfig;
  localStorage.setItem("jdr-last-dice-config", JSON.stringify(cleanConfig));
  action("rollDice", cleanConfig);
}

function updateGameClockFromFields() {
  if (!isMj()) {
    return;
  }
  action("setGameClock", {
    day: elements.gameDayInput.value,
    time: elements.gameClockInput.value,
    weather: elements.gameWeatherInput.value,
    temperature: elements.gameTemperatureInput.value,
    noise: elements.gameNoiseInput.value,
    threat: elements.gameThreatInput.value
  });
}

function setMapZoom(value) {
  mapZoom = clamp(Number(value), 0.65, 1.85);
  elements.drawView.style.setProperty("--map-zoom", mapZoom.toFixed(2));
}

function centerMap() {
  setMapZoom(1);
  elements.drawCanvas.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
}

function toggleMapFullscreen() {
  elements.app.classList.toggle("map-fullscreen");
  elements.fullscreenMapButton.textContent = elements.app.classList.contains("map-fullscreen") ? "Quitter" : "Plein ecran";
  setTimeout(() => renderDrawing(), 80);
}

function drawingThumbnail() {
  try {
    return elements.drawCanvas.toDataURL("image/jpeg", 0.52);
  } catch (error) {
    return "";
  }
}

async function loadServerInfo() {
  try {
    const response = await fetch("/api/info");
    if (!response.ok) {
      return;
    }
    serverInfo = await response.json();
    refreshLoginInvite();
    refreshInvitePanel();
  } catch (error) {
    serverInfo = { localUrl: window.location.origin, networkUrls: [] };
  }
}

function applyRoomFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const requestedRoom = sanitizeRoomClient(params.get("room") || params.get("salle"));

  if (requestedRoom) {
    elements.loginRoom.value = requestedRoom;
    elements.mjRoom.value = requestedRoom;
    if (session?.room && session.room !== requestedRoom) {
      session = null;
      localStorage.removeItem("jdr-session");
    }
    return;
  }

  if (session?.room) {
    elements.loginRoom.value = session.room;
    elements.mjRoom.value = session.room;
  }
}

function sanitizeRoomClient(value) {
  const clean = String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
  return clean;
}

function randomRoomCode() {
  const first = Math.random().toString(36).slice(2, 5).toUpperCase();
  const second = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `JDR-${first}-${second}`;
}

function preferredInviteBase() {
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  if (localHosts.has(window.location.hostname) && serverInfo.networkUrls?.length) {
    return serverInfo.networkUrls[0];
  }
  return window.location.origin;
}

function buildInviteUrl(room, base = preferredInviteBase()) {
  const url = new URL(base);
  url.searchParams.set("room", sanitizeRoomClient(room) || "TABLE-1");
  return url.toString();
}

function refreshLoginInvite() {
  if (!elements.loginInviteLink) {
    return;
  }
  elements.loginInviteLink.value = buildInviteUrl(elements.loginRoom.value);
}

function refreshInvitePanel() {
  if (!session || !elements.inviteLink) {
    return;
  }

  elements.inviteLink.value = buildInviteUrl(session.room);
  const networkUrls = serverInfo.networkUrls || [];
  elements.networkLinks.innerHTML = networkUrls.length
    ? networkUrls
        .map((base) => {
          const link = buildInviteUrl(session.room, base);
          const label = new URL(base).host;
          return `<button class="link-chip" data-copy-link="${escapeHtml(link)}" type="button">${escapeHtml(label)}</button>`;
        })
        .join("")
    : `<span class="network-hint">Lien local uniquement</span>`;

  elements.networkLinks.querySelectorAll("[data-copy-link]").forEach((button) => {
    button.addEventListener("click", () => copyText(button.dataset.copyLink, button));
  });
}

async function copyText(text, button = null) {
  if (!text) {
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
  } catch (error) {
    const input = document.createElement("textarea");
    input.value = text;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.append(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }

  flashButton(button);
}

function flashButton(button) {
  if (!button) {
    return;
  }
  const previous = button.textContent;
  button.textContent = "Copie !";
  button.classList.add("copied");
  setTimeout(() => {
    button.textContent = previous;
    button.classList.remove("copied");
  }, 900);
}

function updateRoomInUrl(room) {
  const url = new URL(window.location.href);
  url.searchParams.set("room", sanitizeRoomClient(room) || "TABLE-1");
  url.searchParams.delete("v");
  window.history.replaceState({}, "", url);
}

function applySceneFromFields() {
  if (!elements.sceneTitleInput || !elements.sceneMoodInput || !elements.sceneThreatInput || !elements.sceneNoticeInput) {
    return;
  }

  updateSceneThreatValue();
  action("setScene", {
    scene: {
      title: elements.sceneTitleInput.value,
      mood: elements.sceneMoodInput.value,
      threat: elements.sceneThreatInput.value,
      notice: elements.sceneNoticeInput.value
    }
  });
}

function applyScenePreset(preset) {
  const presets = {
    exploration: {
      title: "Exploration",
      mood: "foret",
      threat: 1,
      notice: ""
    },
    combat: {
      title: "Rencontre dangereuse",
      mood: "combat",
      threat: 4,
      notice: "La tension monte. Preparez vos actions."
    },
    repos: {
      title: "Halte du groupe",
      mood: "taverne",
      threat: 0,
      notice: "Le groupe reprend son souffle."
    }
  };
  const scene = presets[preset] || presets.exploration;
  if (!elements.sceneTitleInput || !elements.sceneMoodInput || !elements.sceneThreatInput || !elements.sceneNoticeInput) {
    return;
  }

  elements.sceneTitleInput.value = scene.title;
  elements.sceneMoodInput.value = scene.mood;
  elements.sceneThreatInput.value = scene.threat;
  elements.sceneNoticeInput.value = scene.notice;
  applySceneFromFields();
}

function renderScene() {
  const scene = state.scene || {};
  const mood = scene.mood || "donjon";
  const title = scene.title || "Scene en cours";
  const threat = clamp(Number(scene.threat || 0), 0, 6);
  const notice = String(scene.notice || "").trim();

  elements.app.dataset.sceneMood = mood;
  elements.sceneTitleLabel.textContent = title;
  elements.sceneMoodLabel.textContent = moodLabel(mood);
  elements.threatDots.innerHTML = Array.from(
    { length: 6 },
    (_, index) => `<span class="${index < threat ? "active" : ""}"></span>`
  ).join("");

  elements.sceneNotice.hidden = !notice;
  elements.sceneNotice.textContent = notice;

  syncField(elements.sceneTitleInput, title);
  syncField(elements.sceneMoodInput, mood);
  syncField(elements.sceneThreatInput, threat);
  syncField(elements.sceneNoticeInput, notice);
  updateSceneThreatValue();
}

function renderActiveFx() {
  const fx = state.activeFx;
  if (!fx || fx.id === lastFxId) {
    return;
  }

  lastFxId = fx.id;
  playTableFx(fx);
}

function playTableFx(fx) {
  clearTimeout(fxClearTimer);
  const type = fx.type || "runes";
  const label = fxLabel(type);
  const pieces = Array.from({ length: type === "eclair" ? 10 : 18 }, (_, index) => {
    const left = 5 + ((index * 19 + type.length * 7) % 90);
    const delay = (index % 6) * 80;
    return `<span style="--x:${left}%; --d:${delay}ms"></span>`;
  }).join("");

  elements.tableFxLayer.className = `table-fx-layer show fx-${type}`;
  elements.tableFxLayer.innerHTML = `
    <div class="fx-title">${escapeHtml(label)}</div>
    <div class="fx-pieces">${pieces}</div>
  `;

  fxClearTimer = setTimeout(() => {
    elements.tableFxLayer.className = "table-fx-layer";
    elements.tableFxLayer.innerHTML = "";
  }, 2200);
}

function renderPlayers() {
  const players = state.participants || [];
  const onlineCount = players.filter((player) => player.online).length;
  elements.playerCount.textContent = onlineCount;

  if (players.length === 0) {
    elements.playerList.innerHTML = `<div class="empty-state">Personne connecte.</div>`;
    return;
  }

  elements.playerList.innerHTML = players
    .map((player) => {
      const isTurn = state.turn?.id === player.id;
      const status = playerStatus(player, isTurn);
      const setTurnButton = isMj() && player.role !== "MJ" && player.online
        ? isTurn
          ? `<button class="mini-button turn-pick-button danger" data-clear-turn type="button" title="Retirer le tour">Fin tour</button>`
          : `<button class="mini-button turn-pick-button" data-set-turn="${escapeHtml(player.id)}" type="button" title="Donner le tour">Tour</button>`
        : "";
      const kickButton = isMj() && player.id !== session.clientId
        ? `<button class="mini-button kick-button danger" data-kick-player="${escapeHtml(player.id)}" data-kick-name="${escapeHtml(player.name)}" type="button" title="Exclure de la partie">Exclure</button>`
        : "";
      const playerActions = setTurnButton || kickButton
        ? `<span class="player-actions ${setTurnButton && kickButton ? "two-actions" : "one-action"}">${setTurnButton}${kickButton}</span>`
        : "";
      return `
        <article class="player-row ${isTurn ? "is-turn" : ""} ${escapeHtml(status.className)}" title="${escapeHtml(status.tooltip)}">
          <span class="player-status-dot" aria-hidden="true"></span>
          <span class="avatar small" style="--avatar-color:${escapeHtml(player.color)}">${escapeHtml(initials(player.name))}</span>
          <span class="player-main">
            <span class="player-name">${escapeHtml(player.name)}</span>
            <span class="meta-line">${escapeHtml(status.label)}</span>
          </span>
          <span class="${player.online ? "role-badge" : "offline-badge"}">${player.online ? escapeHtml(player.role) : "offline"}</span>
          ${playerActions}
        </article>
      `;
    })
    .join("");

  elements.playerList.querySelectorAll("[data-set-turn]").forEach((button) => {
    button.addEventListener("click", () => {
      action("setTurn", { playerId: button.dataset.setTurn });
    });
  });

  elements.playerList.querySelectorAll("[data-clear-turn]").forEach((button) => {
    button.addEventListener("click", () => {
      action("clearTurn", {});
    });
  });

  elements.playerList.querySelectorAll("[data-kick-player]").forEach((button) => {
    button.addEventListener("click", () => {
      const name = button.dataset.kickName || "ce joueur";
      if (confirm(`Retirer ${name} de la table ?`)) {
        action("kickParticipant", { playerId: button.dataset.kickPlayer });
      }
    });
  });
}

function playerStatus(player, isTurn) {
  if (player.role === "MJ") {
    return { className: "status-mj", label: player.online ? "MJ connecte" : "MJ hors ligne", tooltip: "Maitre du jeu" };
  }
  if (!player.online) {
    return { className: "status-offline", label: "Hors ligne", tooltip: "Ce joueur n'est plus connecte" };
  }
  if (isTurn) {
    return { className: "status-authorized", label: "Autorise a lancer", tooltip: "Ce joueur peut lancer ses des" };
  }
  return { className: "status-waiting", label: "En attente", tooltip: "Connecte, attend l'autorisation du MJ" };
}

function renderCharacters() {
  if (!elements.characterList) {
    return;
  }

  const characters = state.characters || [];

  if (characters.length === 0) {
    elements.characterList.innerHTML = `<div class="empty-state">Aucune fiche.</div>`;
    return;
  }

  elements.characterList.innerHTML = characters
    .map((character) => {
      const mainButton = isMj() ? "Editer" : "Voir";
      const deleteButton = isMj()
        ? `<button class="mini-button" data-delete-character="${escapeHtml(character.id)}" type="button">Suppr</button>`
        : "";
      const pvMax = metricMaxValue(character.pvMax, 4);
      const staminaMax = metricMaxValue(character.staminaMax, 4);
      const pv = metricValue(character.pv, pvMax);
      const stamina = metricValue(character.stamina, staminaMax);
      const pvControls = vitalQuickControls(character.id, "pv");
      const staminaControls = vitalQuickControls(character.id, "stamina");
      const ownerColor = participantColor(character.player) || colorFromString(character.name);
      const status = characterSurvivalStatus(character, pv, pvMax);
      const wounds = characterWounds(character);
      const talents = characterTalents(character);
      const survival = characterSurvivalNeeds(character);
      const collapsed = collapsedCharacters[character.id] !== "open";

      return `
        <article class="character-card sheet-vitals survivor-status-${escapeHtml(status.key)} ${collapsed ? "collapsed" : ""}" data-open-character-card="${escapeHtml(character.id)}">
          <header>
            <div class="character-main sheet-id">
              <span class="avatar small" style="--avatar-color:${escapeHtml(ownerColor)}">${escapeHtml(initials(character.name))}</span>
              <div>
                <h3>${escapeHtml(character.name)}</h3>
                <div class="meta-line">${escapeHtml(character.archetype || "Survivant")} - ${escapeHtml(character.player || "Sans joueur")}</div>
              </div>
            </div>
            <button class="mini-button sheet-toggle-button" data-toggle-character="${escapeHtml(character.id)}" type="button">${collapsed ? "Ouvrir" : "Fermer"}</button>
          </header>
          <div class="character-compact-vitals" aria-label="Resume PV et stamina">
            ${compactVital("PV", pv, pvMax, "pv")}
            ${compactVital("STA", stamina, staminaMax, "stamina")}
          </div>
          <div class="character-fold">
            <div class="character-vital-strip" aria-label="PV et stamina">
              <div class="hero-vital pv ${metricToneClass(pv, pvMax)}">
                <div class="vital-topline">
                  <span>PV</span>
                  <strong>${pv}/${pvMax}</strong>
                  ${pvControls}
                </div>
                <div class="vital-meter" style="--vital-fill:${metricPercent(pv, pvMax)}%"><span></span></div>
              </div>
              <div class="hero-vital stamina ${metricToneClass(stamina, staminaMax)}">
                <div class="vital-topline">
                  <span>Stamina</span>
                  <strong>${stamina}/${staminaMax}</strong>
                  ${staminaControls}
                </div>
                <div class="vital-meter" style="--vital-fill:${metricPercent(stamina, staminaMax)}%"><span></span></div>
              </div>
            </div>
            <div class="card-actions">
              <button class="mini-button" data-open-character="${escapeHtml(character.id)}" type="button">${mainButton}</button>
              ${deleteButton}
            </div>
            <div class="survivor-status-row">
              <span class="survivor-status">${escapeHtml(status.label)}</span>
              <span class="survivor-file-id">DOSSIER ${escapeHtml((character.id || "000000").slice(0, 6).toUpperCase())}</span>
            </div>
            <div class="survival-grid">
              <div class="survival-meter"><span>Arme</span><strong>${escapeHtml(survival.weapon)}</strong></div>
              <div class="survival-meter ${survival.infectionClass}"><span>Infection</span><strong>${escapeHtml(survival.infection)}</strong></div>
              <div class="survival-meter"><span>Faim</span><div class="vital-pips">${metricPips(survival.hunger)}</div></div>
              <div class="survival-meter"><span>Soif</span><div class="vital-pips">${metricPips(survival.thirst)}</div></div>
            </div>
            <div class="sheet-stat-grid">
              ${characterStatSummary(character).map((stat) => compactStat(stat)).join("")}
            </div>
            <div class="survivor-tags">
              ${wounds.map((wound) => `<span class="wound-tag">${escapeHtml(wound)}</span>`).join("")}
              ${talents.map((talent) => `<span class="talent-tag">${escapeHtml(talent)}</span>`).join("")}
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  elements.characterList.querySelectorAll("[data-open-character-card]").forEach((card) => {
    card.addEventListener("click", (event) => {
      if (event.target.closest("button")) {
        return;
      }
      toggleCharacterFold(card.dataset.openCharacterCard);
    });
  });

  elements.characterList.querySelectorAll("[data-open-character]").forEach((button) => {
    button.addEventListener("click", () => openCharacter(button.dataset.openCharacter));
  });

  elements.characterList.querySelectorAll("[data-toggle-character]").forEach((button) => {
    button.addEventListener("click", () => {
      toggleCharacterFold(button.dataset.toggleCharacter);
    });
  });

  elements.characterList.querySelectorAll("[data-adjust-character]").forEach((button) => {
    button.addEventListener("click", () => {
      adjustCharacterMetric(button.dataset.characterId, button.dataset.metric, Number(button.dataset.delta));
    });
  });

  elements.characterList.querySelectorAll("[data-delete-character]").forEach((button) => {
    button.addEventListener("click", () => {
      action("deleteCharacter", { id: button.dataset.deleteCharacter });
    });
  });
}

function renderCharacterDetails() {
  if (!elements.characterDetailsPanel) {
    return;
  }

  const characters = state.characters || [];
  if (characters.length === 0) {
    elements.characterDetailsPanel.innerHTML = `<div class="empty-state">Aucune fiche a afficher.</div>`;
    return;
  }

  elements.characterDetailsPanel.innerHTML = characters
    .map((character) => detailedCharacterCard(character))
    .join("");

  elements.characterDetailsPanel.querySelectorAll("[data-open-character-detail]").forEach((button) => {
    button.addEventListener("click", () => openCharacter(button.dataset.openCharacterDetail));
  });

  elements.characterDetailsPanel.querySelectorAll("[data-delete-character-detail]").forEach((button) => {
    button.addEventListener("click", () => {
      if (confirm("Supprimer cette fiche ?")) {
        action("deleteCharacter", { id: button.dataset.deleteCharacterDetail });
      }
    });
  });
}

function detailedCharacterCard(character) {
  const pvMax = metricMaxValue(character.pvMax, 4);
  const staminaMax = metricMaxValue(character.staminaMax, 4);
  const pv = metricValue(character.pv, pvMax);
  const stamina = metricValue(character.stamina, staminaMax);
  const ownerColor = participantColor(character.player) || colorFromString(character.name);
  const status = characterSurvivalStatus(character, pv, pvMax);
  const survival = characterSurvivalNeeds(character);
  const equipment = compactText(character.equipment || "Aucun equipement note");
  const notes = compactText(character.notes || "Aucune note");

  return `
    <article class="character-detail-card survivor-status-${escapeHtml(status.key)}">
      <header>
        <span class="avatar" style="--avatar-color:${escapeHtml(ownerColor)}">${escapeHtml(initials(character.name))}</span>
        <div>
          <h3>${escapeHtml(character.name)}</h3>
          <span>${escapeHtml(character.archetype || "Survivant")} - ${escapeHtml(character.player || "Sans joueur")}</span>
        </div>
        ${isMj() ? `
          <span class="detail-card-actions">
            <button class="mini-button" data-open-character-detail="${escapeHtml(character.id)}" type="button">Editer</button>
            <button class="mini-button danger" data-delete-character-detail="${escapeHtml(character.id)}" type="button">Suppr</button>
          </span>
        ` : ""}
      </header>
      <div class="detail-vitals">
        ${detailVital("PV", pv, pvMax, "pv")}
        ${detailVital("Stamina", stamina, staminaMax, "stamina")}
      </div>
      <div class="detail-status-grid">
        <span><small>Etat</small><strong>${escapeHtml(status.label)}</strong></span>
        <span><small>Arme</small><strong>${escapeHtml(survival.weapon)}</strong></span>
        <span><small>Infection</small><strong>${escapeHtml(survival.infection)}</strong></span>
        <span><small>Niveau</small><strong>${escapeHtml(character.level || "-")}</strong></span>
      </div>
      <div class="detail-stat-grid">
        ${characterStatSummary(character).map((stat) => detailStat(stat)).join("")}
      </div>
      <div class="detail-text-block">
        <span>Equipement</span>
        <p>${escapeHtml(equipment)}</p>
      </div>
      <div class="detail-text-block">
        <span>Notes</span>
        <p>${escapeHtml(notes)}</p>
      </div>
    </article>
  `;
}

function compactStat(stat) {
  return `
    <div class="compact-stat" style="--stat-fill:${stat.percent}%">
      <span>${escapeHtml(stat.shortLabel)}</span>
      <strong>${escapeHtml(stat.value)}/20</strong>
      <i></i>
    </div>
  `;
}

function detailStat(stat) {
  return `
    <div class="detail-stat" style="--stat-fill:${stat.percent}%">
      <div><span>${escapeHtml(stat.label)}</span><strong>${escapeHtml(stat.value)}/20</strong></div>
      <i></i>
    </div>
  `;
}

function detailVital(label, value, max, type) {
  return `
    <div class="detail-vital ${escapeHtml(type)} ${escapeHtml(metricToneClass(value, max))}" style="--vital-fill:${metricPercent(value, max)}%">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}/${escapeHtml(max)}</strong>
      <i></i>
    </div>
  `;
}

function characterStatSummary(character) {
  const stats = character.stats || {};
  return characterStatDefinitions.map((definition) => {
    const raw = stats[definition.key] ?? (definition.legacy || []).map((key) => stats[key]).find((value) => value !== undefined && value !== "");
    const value = statScore(raw);
    return {
      ...definition,
      shortLabel: statShortLabel(definition.label),
      value,
      percent: Math.round((value / 20) * 100)
    };
  });
}

function statShortLabel(label) {
  return String(label || "")
    .slice(0, 3)
    .toUpperCase();
}

function statScore(value, fallback = 10) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  return Math.trunc(clamp(Number(value), 0, 20));
}

function compactVital(label, value, max, type) {
  const tone = metricToneClass(value, max);
  return `
    <div class="compact-vital ${escapeHtml(type)} ${escapeHtml(tone)}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}/${escapeHtml(max)}</strong>
      <div class="compact-vital-meter" style="--vital-fill:${metricPercent(value, max)}%"><i></i></div>
    </div>
  `;
}

function toggleCharacterFold(id) {
  collapsedCharacters[id] = collapsedCharacters[id] === "open" ? "closed" : "open";
  localStorage.setItem("jdr-collapsed-characters", JSON.stringify(collapsedCharacters));
  renderCharacters();
}

function vitalQuickControls(characterId, metric) {
  if (!isMj()) {
    return "";
  }

  const label = metric === "stamina" ? "stamina" : "PV";
  return `
    <div class="vital-quick-controls" aria-label="Modifier ${escapeHtml(label)}">
      <button class="vital-step danger" data-adjust-character data-character-id="${escapeHtml(characterId)}" data-metric="${escapeHtml(metric)}" data-delta="-1" type="button">-</button>
      <button class="vital-step" data-adjust-character data-character-id="${escapeHtml(characterId)}" data-metric="${escapeHtml(metric)}" data-delta="1" type="button">+</button>
    </div>
  `;
}

function adjustCharacterMetric(characterId, metric, delta) {
  if (!isMj()) {
    return;
  }

  const field = metric === "stamina" ? "stamina" : "pv";
  const character = state?.characters?.find((entry) => entry.id === characterId);
  if (!character) {
    return;
  }

  const updated = {
    ...character,
    stats: { ...(character.stats || {}) },
    [field]: String(clamp(metricValue(character[field], metricMaxValue(character[`${field}Max`], 4)) + Number(delta || 0), 0, metricMaxValue(character[`${field}Max`], 4)))
  };
  if (field === "pv") {
    updated.pvMax = String(metricMaxValue(character.pvMax, 4));
  } else {
    updated.staminaMax = String(metricMaxValue(character.staminaMax, 4));
  }

  action("saveCharacter", { character: updated });
}

function characterSurvivalStatus(character, pv, pvMax = 4) {
  const notes = normalizeSearchText(`${character.notes || ""} ${character.equipment || ""}`);
  const ratio = metricValue(pv, pvMax) / metricMaxValue(pvMax, 4);
  if (notes.includes("mort")) {
    return { key: "dead", label: "Mort" };
  }
  if (notes.includes("infect")) {
    return { key: "infected", label: "Infecte" };
  }
  if (notes.includes("inconscient") || /\bko\b/.test(notes)) {
    return { key: "unconscious", label: "Inconscient" };
  }
  if (pv <= 0) {
    return { key: "unconscious", label: "Inconscient" };
  }
  if (ratio <= 0.25) {
    return { key: "critical", label: "Critique" };
  }
  if (ratio <= 0.5) {
    return { key: "wounded", label: "Blesse" };
  }
  return { key: "healthy", label: "Sain" };
}

function characterWounds(character) {
  const text = normalizeSearchText(`${character.notes || ""} ${character.equipment || ""}`);
  const wounds = [
    ["morsure", "Morsure"],
    ["saign", "Saignement"],
    ["fract", "Fracture"],
    ["brul", "Brulure"],
    ["infect", "Infection"],
    ["fatigue", "Fatigue"]
  ];
  return wounds.filter(([key]) => text.includes(key)).map(([, label]) => label).slice(0, 3);
}

function characterTalents(character) {
  const text = normalizeSearchText(`${character.archetype || ""} ${character.equipment || ""} ${character.notes || ""}`);
  const talents = [
    ["med", "MED"],
    ["soin", "MED"],
    ["tir", "TIR"],
    ["fusil", "TIR"],
    ["arc", "TIR"],
    ["meca", "MEC"],
    ["bricol", "MEC"],
    ["furt", "FUR"],
    ["discret", "FUR"],
    ["survie", "SURV"],
    ["radio", "RAD"],
    ["chef", "CMD"]
  ];
  const found = [];
  for (const [key, label] of talents) {
    if (text.includes(key) && !found.includes(label)) {
      found.push(label);
    }
  }
  return (found.length ? found : ["SURV"]).slice(0, 4);
}

function characterSurvivalNeeds(character) {
  const equipment = String(character.equipment || "").trim();
  const notes = normalizeSearchText(`${character.notes || ""} ${equipment}`);
  const firstEquipment = equipment.split(/\n|,|;/).map((item) => item.trim()).find(Boolean);
  const infectionRisk = notes.includes("infect") || notes.includes("morsure");

  return {
    weapon: firstEquipment || "Arme inconnue",
    infection: infectionRisk ? "Risque" : "Non",
    infectionClass: infectionRisk ? "infection-risk" : "",
    hunger: survivalNeedLevel(notes, ["affame", "faim", "ration"]),
    thirst: survivalNeedLevel(notes, ["deshydrat", "soif", "eau"])
  };
}

function survivalNeedLevel(text, keywords) {
  if (keywords.some((keyword) => text.includes(keyword))) {
    return text.includes("critique") || text.includes("vide") ? 1 : 2;
  }
  return 4;
}

function rollToneClass(entry) {
  const values = flattenRolls(entry).map((roll) => Number(roll.value));
  const sides = Number(entry.sides);
  if (!Number.isFinite(sides) || sides < 2 || values.length === 0) {
    return "";
  }
  const hasCritical = values.includes(sides);
  const hasFumble = values.includes(1);
  if (hasCritical && !hasFumble) {
    return "roll-critical";
  }
  if (hasFumble && !hasCritical) {
    return "roll-fumble";
  }
  return "";
}

function renderDiceLog() {
  const entries = state.diceLog || [];
  renderTopDiceTerminal(entries);

  if (entries.length === 0) {
    elements.diceLog.innerHTML = `<div class="empty-state">Aucun jet.</div>`;
    return;
  }

  elements.diceLog.innerHTML = entries
    .slice(0, 8)
    .map((entry) => {
      const modifierText = Number(entry.modifier || 0) ? ` ${Number(entry.modifier) > 0 ? "+" : ""}${entry.modifier}` : "";
      const expression = `${entry.repeat > 1 ? `${entry.repeat} x ` : ""}${entry.count}d${entry.sides}${modifierText}`;
      const details = rollDetails(entry);
      const tone = rollToneClass(entry);

      return `
        <article class="dice-entry ${tone}">
          <header>
            <strong>${escapeHtml(entry.playerName)}</strong>
            <span class="roll-total">${entry.grandTotal}</span>
          </header>
          <div class="roll-expression">${escapeHtml(expression)}</div>
          <div class="roll-breakdown"><span>Detail</span>${escapeHtml(details)}</div>
          <div class="meta-line">${formatTime(entry.createdAt)}</div>
        </article>
      `;
    })
    .join("");
}

function renderTopDiceTerminal(entries) {
  if (!elements.topDiceTerminal) {
    return;
  }

  if (entries.length === 0) {
    elements.topDiceTerminal.innerHTML = `
      <div class="terminal-line muted"><span>00:00:00</span><strong>SYSTEM</strong><em>&gt; aucun lancer en memoire</em></div>
    `;
    return;
  }

  const visibleEntries = entries.slice(0, 5).reverse();
  elements.topDiceTerminal.innerHTML = visibleEntries
    .map((entry) => {
      const modifierText = Number(entry.modifier || 0) ? ` ${Number(entry.modifier) > 0 ? "+" : ""}${entry.modifier}` : "";
      const expression = `${entry.repeat > 1 ? `${entry.repeat}x ` : ""}${entry.count}d${entry.sides}${modifierText}`;
      const details = compactRollDetails(rollDetails(entry));
      const tone = rollToneClass(entry);
      return `
        <div class="terminal-line ${tone}">
          <span class="terminal-time">${escapeHtml(formatTime(entry.createdAt))}</span>
          <span class="terminal-main">
            <strong>${escapeHtml(entry.playerName)}</strong>
            <em>&gt; ${escapeHtml(expression)}</em>
          </span>
          <span class="terminal-detail">${escapeHtml(details)}</span>
          <b class="terminal-total"><small>Total</small>${escapeHtml(entry.grandTotal)}</b>
        </div>
      `;
    })
    .join("");
  elements.topDiceTerminal.scrollTop = elements.topDiceTerminal.scrollHeight;
}

function renderSavedDrawings() {
  const savedDrawings = state.savedDrawings || [];
  const previousValue = elements.savedDrawingSelect.value;

  if (savedDrawings.length === 0) {
    elements.savedDrawingSelect.innerHTML = `<option value="">Aucun dessin sauvegarde</option>`;
    elements.savedDrawingList.innerHTML = `<div class="empty-state">Aucune sauvegarde de plan.</div>`;
    elements.loadDrawingButton.disabled = true;
    elements.duplicateSavedDrawingButton.disabled = true;
    elements.deleteSavedDrawingButton.disabled = true;
    return;
  }

  elements.savedDrawingSelect.innerHTML = savedDrawings
    .map((drawing) => {
      const label = `${drawing.name} (${drawing.strokeCount || 0})`;
      return `<option value="${escapeHtml(drawing.id)}">${escapeHtml(label)}</option>`;
    })
    .join("");

  const preferred = savedDrawings.some((drawing) => drawing.id === previousValue)
    ? previousValue
    : state.activeSavedDrawingId || savedDrawings[0].id;
  elements.savedDrawingSelect.value = preferred;

  const readonly = !isMj();
  elements.loadDrawingButton.disabled = readonly || !elements.savedDrawingSelect.value;
  elements.duplicateSavedDrawingButton.disabled = readonly || !elements.savedDrawingSelect.value;
  elements.deleteSavedDrawingButton.disabled = readonly || !elements.savedDrawingSelect.value;

  elements.savedDrawingList.innerHTML = savedDrawings
    .slice(0, 6)
    .map((drawing) => `
      <article class="saved-plan-card ${drawing.id === elements.savedDrawingSelect.value ? "active" : ""}" data-select-saved-drawing="${escapeHtml(drawing.id)}">
        <div class="saved-plan-thumb">${drawing.thumbnail ? `<img src="${escapeHtml(drawing.thumbnail)}" alt="">` : `<span>PLAN</span>`}</div>
        <div class="saved-plan-main">
          <strong>${escapeHtml(drawing.name)}</strong>
          <span>v${escapeHtml(drawing.version || 1)} - ${escapeHtml(formatDateTime(drawing.updatedAt || drawing.createdAt))}</span>
          <span>${escapeHtml(drawing.strokeCount || 0)} traits - ${escapeHtml(drawing.updatedBy || "MJ")}</span>
        </div>
      </article>
    `)
    .join("");

  elements.savedDrawingList.querySelectorAll("[data-select-saved-drawing]").forEach((card) => {
    card.addEventListener("click", () => {
      elements.savedDrawingSelect.value = card.dataset.selectSavedDrawing;
      renderSavedDrawings();
    });
  });
}

function buildDiceButtons() {
  const dice = allDiceTypes();
  if (!dice.includes(selectedDie)) {
    selectedDie = 20;
  }

  if (elements.diceSelect) {
    elements.diceSelect.innerHTML = dice
      .map((sides) => {
        const suffix = diceTypes.includes(sides) ? "" : " - perso";
        return `<option value="${escapeHtml(sides)}" ${sides === selectedDie ? "selected" : ""}>D${escapeHtml(sides)}${suffix}</option>`;
      })
      .join("");
  }
}

function allDiceTypes() {
  return [...new Set([...diceTypes, ...customDiceTypes, selectedDie])]
    .filter((value) => Number.isFinite(Number(value)) && Number(value) >= 2 && Number(value) <= 1000)
    .map((value) => Math.trunc(Number(value)))
    .sort((a, b) => a - b);
}

function addCustomDie() {
  const rawValue = String(elements.customDieSides.value || "").trim();
  if (!rawValue) {
    return;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    return;
  }

  const sides = Math.trunc(clamp(parsed, 2, 1000));
  selectedDie = sides;
  if (!diceTypes.includes(sides) && !customDiceTypes.includes(sides)) {
    customDiceTypes = sanitizeCustomDice([...customDiceTypes, sides]);
    localStorage.setItem("jdr-custom-dice", JSON.stringify(customDiceTypes));
  }
  elements.customDieSides.value = "";
  buildDiceButtons();
}

function maybePlayRollAnimation() {
  const activeRoll = state.activeRoll;
  if (!activeRoll) {
    if (!lastAnimatedRollId) {
      renderIdleDice();
    }
    return;
  }

  if (activeRoll.id === lastAnimatedRollId) {
    return;
  }

  lastAnimatedRollId = activeRoll.id;
  playRollAnimation(activeRoll);
}

function playRollAnimation(roll) {
  clearTimeout(rollRevealTimer);
  const dice = flattenRolls(roll).slice(0, 18);
  const overflow = flattenRolls(roll).length - dice.length;
  const small = dice.length > 8 ? " small" : "";
  const sparks = Array.from({ length: 20 }, (_, index) => {
    const seed = Number(roll.seed || 0) + index * 53;
    const left = 8 + (seed % 85);
    const top = 18 + ((seed * 7) % 58);
    const delay = (index % 8) * 70;
    return `<span class="spark" style="left:${left}%; top:${top}%; animation-delay:${delay}ms"></span>`;
  }).join("");

  setAvatar(elements.rollerAvatar, roll.playerName, roll.playerColor || "#b7332c");
  const modifierText = Number(roll.modifier || 0) ? ` ${Number(roll.modifier) > 0 ? "+" : ""}${roll.modifier}` : "";
  elements.rollerText.textContent = `${roll.playerName} lance ${roll.count}d${roll.sides}${modifierText}${roll.repeat > 1 ? ` x ${roll.repeat}` : ""}`;
  elements.rollResult.textContent = "Les des roulent...";
  elements.diceAnimationArea.classList.remove("is-rolling", "roll-critical", "roll-fumble");
  const tone = rollToneClass(roll);
  if (tone) {
    elements.diceAnimationArea.classList.add(tone);
  }
  void elements.diceAnimationArea.offsetWidth;
  elements.diceAnimationArea.classList.add("is-rolling");

  elements.diceStage.innerHTML = dice
    .map((item, index) => {
      const seed = Number(roll.seed || 0) + index * 137;
      const rx = 720 + (seed % 3) * 360;
      const ry = 720 + (seed % 2) * 360;
      const rz = 360 + (seed % 4) * 360;
      const delay = Math.min(index * 45, 360);
      return `
        <div class="die-3d${small}" style="--rx:${rx}deg; --ry:${ry}deg; --rz:${rz}deg; animation-delay:${delay}ms">
          <span class="die-face front">${escapeHtml(item.value)}</span>
          <span class="die-face back">D${escapeHtml(roll.sides)}</span>
          <span class="die-face right">${escapeHtml(Math.max(1, item.value - 1))}</span>
          <span class="die-face left">${escapeHtml(Math.min(roll.sides, item.value + 1))}</span>
          <span class="die-face top">${escapeHtml(roll.count)}</span>
          <span class="die-face bottom">${escapeHtml(roll.repeat)}</span>
        </div>
      `;
    })
    .join("") + sparks;

  rollRevealTimer = setTimeout(() => {
    elements.rollResult.textContent = `Total ${roll.grandTotal} - ${rollDetails(roll)}${overflow > 0 ? ` (+${overflow} autres des)` : ""}`;
    elements.diceAnimationArea.classList.remove("is-rolling");
  }, Math.max(800, Number(roll.durationMs || 1800)));
}

function renderIdleDice() {
  elements.rollerText.textContent = "En attente du prochain jet";
  setAvatar(elements.rollerAvatar, "D", "#b7332c");
  elements.rollResult.textContent = "Le MJ autorise un joueur, puis le droit disparait apres son jet.";
  elements.diceAnimationArea.classList.remove("is-rolling", "roll-critical", "roll-fumble");
  elements.diceStage.innerHTML = `<div class="idle-dice">D20</div>`;
}

function flattenRolls(roll) {
  return (roll.groups || []).flatMap((group, groupIndex) =>
    (group.rolls || []).map((value, rollIndex) => ({
      value,
      groupIndex,
      rollIndex
    }))
  );
}

function rollDetails(entry) {
  return (entry.groups || [])
    .map((group) => {
      const modifier = Number(group.modifier ?? entry.modifier ?? 0);
      const modText = modifier ? ` ${modifier > 0 ? "+" : ""}${modifier}` : "";
      const raw = Number.isFinite(Number(group.rawTotal)) ? ` (${group.rawTotal}${modText})` : "";
      return `[${group.rolls.join(", ")}]${raw} = ${group.total}`;
    })
    .join(" | ");
}

function compactRollDetails(value) {
  const clean = String(value || "").replace(/\s+/g, " ").trim();
  if (clean.length <= 62) {
    return clean;
  }
  return `${clean.slice(0, 59)}...`;
}

function renderTokens() {
  if (!elements.tokenLayer) {
    return;
  }

  if (isDraggingToken) {
    return;
  }

  const tokens = state.tokens || [];
  elements.tokenLayer.innerHTML = tokens
    .map(
      (token) => `
        <div class="map-token" data-token-id="${escapeHtml(token.id)}" style="left:${token.x * 100}%; top:${token.y * 100}%; background:${escapeHtml(token.color)}">
          <span>${escapeHtml(shortTokenName(token.name))}</span>
          <button data-delete-token="${escapeHtml(token.id)}" type="button" title="Supprimer">x</button>
        </div>
      `
    )
    .join("");

  elements.tokenLayer.querySelectorAll(".map-token").forEach((tokenElement) => {
    tokenElement.addEventListener("pointerdown", startTokenDrag);
  });

  elements.tokenLayer.querySelectorAll("[data-delete-token]").forEach((button) => {
    button.addEventListener("pointerdown", (event) => event.stopPropagation());
    button.addEventListener("click", () => {
      action("deleteToken", { id: button.dataset.deleteToken });
    });
  });
}

function startTokenDrag(event) {
  if (event.target.matches("button")) {
    return;
  }

  const tokenElement = event.currentTarget;
  const tokenId = tokenElement.dataset.tokenId;
  const token = state.tokens.find((item) => item.id === tokenId);
  if (!token) {
    return;
  }

  isDraggingToken = true;
  tokenElement.setPointerCapture(event.pointerId);

  const move = (moveEvent) => {
    const position = pointInMap(moveEvent);
    tokenElement.style.left = `${position.x * 100}%`;
    tokenElement.style.top = `${position.y * 100}%`;
    token.x = position.x;
    token.y = position.y;
  };

  const stop = () => {
    tokenElement.removeEventListener("pointermove", move);
    tokenElement.removeEventListener("pointerup", stop);
    tokenElement.removeEventListener("pointercancel", stop);
    isDraggingToken = false;
    action("updateToken", { token });
  };

  move(event);
  tokenElement.addEventListener("pointermove", move);
  tokenElement.addEventListener("pointerup", stop);
  tokenElement.addEventListener("pointercancel", stop);
}

function pointInMap(event) {
  const rect = elements.battleMap.getBoundingClientRect();
  return {
    x: clamp((event.clientX - rect.left) / rect.width, 0.02, 0.98),
    y: clamp((event.clientY - rect.top) / rect.height, 0.02, 0.98)
  };
}

function setDrawingMode(mode) {
  drawingMode = mode;
  elements.penTool.classList.toggle("active", mode === "pen");
  elements.markerTool.classList.toggle("active", mode === "marker");
  elements.eraseTool.classList.toggle("active", mode === "erase");
  elements.eyedropperTool.classList.toggle("active", mode === "eyedropper");
  elements.drawView.classList.toggle("is-eyedropper", mode === "eyedropper");
}

function setCurrentColor(color) {
  const clean = normalizeHexColor(color) || "#e24035";
  elements.drawColor.value = clean;
  elements.currentColorPreview.style.setProperty("--current-color", clean);
  markActiveSwatch(clean);
}

function markActiveSwatch(color) {
  elements.colorSwatches.querySelectorAll("[data-color]").forEach((button) => {
    button.classList.toggle("active", button.dataset.color.toLowerCase() === String(color).toLowerCase());
  });
}

function startDrawing(event) {
  if (!isMj()) {
    return;
  }

  if (drawingMode === "eyedropper") {
    pickCanvasColor(event);
    return;
  }

  isDrawing = true;
  elements.drawCanvas.setPointerCapture(event.pointerId);
  currentStroke = {
    color: elements.drawColor.value,
    width: Number(elements.drawSize.value),
    mode: drawingMode,
    points: [pointInCanvas(event)]
  };
}

function pickCanvasColor(event) {
  const canvas = elements.drawCanvas;
  const context = canvas.getContext("2d");
  const [nx, ny] = pointInCanvas(event);
  const x = Math.round(nx * (canvas.width - 1));
  const y = Math.round(ny * (canvas.height - 1));
  const pixel = context.getImageData(x, y, 1, 1).data;
  const color = rgbToHex(pixel[0], pixel[1], pixel[2]);

  setCurrentColor(color);
  setDrawingMode("pen");
}

function continueDrawing(event) {
  if (!isDrawing || !currentStroke) {
    return;
  }

  currentStroke.points.push(pointInCanvas(event));
  renderDrawing(currentStroke);
}

function finishDrawing() {
  if (!isMj()) {
    isDrawing = false;
    currentStroke = null;
    return;
  }

  if (!isDrawing || !currentStroke) {
    return;
  }

  isDrawing = false;
  if (currentStroke.points.length > 1) {
    action("drawStroke", { stroke: currentStroke });
    if (autoSaveDrawing && isMj()) {
      setTimeout(() => {
        action("saveDrawing", { name: "Sauvegarde auto", thumbnail: drawingThumbnail() });
      }, 650);
    }
  }
  currentStroke = null;
}

function pointInCanvas(event) {
  const rect = elements.drawCanvas.getBoundingClientRect();
  return [
    clamp((event.clientX - rect.left) / rect.width, 0, 1),
    clamp((event.clientY - rect.top) / rect.height, 0, 1)
  ];
}

function renderDrawing(extraStroke = null) {
  const canvas = elements.drawCanvas;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  fillDrawingBackground(context, canvas);

  for (const stroke of [...(state?.drawings || []), extraStroke].filter(Boolean)) {
    drawStroke(context, canvas, stroke);
  }
}

function fillDrawingBackground(context, canvas) {
  const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "#d8caa8");
  gradient.addColorStop(0.48, "#bda982");
  gradient.addColorStop(1, "#d6c29b");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.save();
  context.globalAlpha = 0.22;
  for (let index = 0; index < 22; index += 1) {
    const x = (index * 233) % canvas.width;
    const y = (index * 97) % canvas.height;
    const radius = 34 + ((index * 17) % 92);
    const stain = context.createRadialGradient(x, y, 0, x, y, radius);
    stain.addColorStop(0, index % 3 === 0 ? "rgba(70, 45, 27, 0.32)" : "rgba(96, 79, 49, 0.22)");
    stain.addColorStop(1, "rgba(70, 45, 27, 0)");
    context.fillStyle = stain;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  context.globalAlpha = 1;
  context.strokeStyle = "rgba(52, 66, 54, 0.18)";
  context.lineWidth = 1;
  const grid = 48;
  for (let x = 0; x <= canvas.width; x += grid) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, canvas.height);
    context.stroke();
  }
  for (let y = 0; y <= canvas.height; y += grid) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(canvas.width, y);
    context.stroke();
  }

  context.strokeStyle = "rgba(85, 101, 73, 0.16)";
  context.lineWidth = 2;
  for (let line = 0; line < 8; line += 1) {
    context.beginPath();
    for (let x = -60; x <= canvas.width + 60; x += 60) {
      const y = 80 + line * 78 + Math.sin((x + line * 40) / 85) * 18;
      if (x === -60) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    }
    context.stroke();
  }

  context.strokeStyle = "rgba(62, 48, 35, 0.16)";
  context.lineWidth = 4;
  [canvas.width * 0.28, canvas.width * 0.62].forEach((x) => {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x + 18, canvas.height);
    context.stroke();
  });

  context.strokeStyle = "rgba(80, 34, 28, 0.2)";
  context.lineWidth = 8;
  context.strokeRect(14, 14, canvas.width - 28, canvas.height - 28);
  context.restore();
}

function drawStroke(context, canvas, stroke) {
  const points = stroke.points || [];
  if (points.length < 2) {
    return;
  }

  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = stroke.mode === "marker" ? stroke.width * 1.8 : stroke.width;
  context.strokeStyle = stroke.color;
  context.globalAlpha = stroke.mode === "marker" ? 0.42 : 1;
  context.globalCompositeOperation = stroke.mode === "erase" ? "destination-out" : "source-over";
  context.beginPath();
  context.moveTo(points[0][0] * canvas.width, points[0][1] * canvas.height);

  for (const point of points.slice(1)) {
    context.lineTo(point[0] * canvas.width, point[1] * canvas.height);
  }

  context.stroke();
  context.restore();
}

function saveCharacter() {
  if (!isMj()) {
    alert("Seul le MJ peut modifier les fiches.");
    return;
  }

  const pvMax = metricMaxValue(elements.characterPvMax.value, 4);
  const staminaMax = metricMaxValue(elements.characterStaminaMax.value, 4);
  const character = {
    id: elements.characterId.value,
    name: elements.characterName.value,
    player: elements.characterPlayer.value,
    archetype: elements.characterArchetype.value,
    level: elements.characterLevel.value,
    pv: String(metricValue(elements.characterPv.value, pvMax)),
    pvMax: String(pvMax),
    stamina: String(metricValue(elements.characterStamina.value, staminaMax)),
    staminaMax: String(staminaMax),
    stats: {
      force: String(statScore(elements.statForce.value)),
      agilite: String(statScore(elements.statAgilite.value)),
      resistance: String(statScore(elements.statResistance.value)),
      perception: String(statScore(elements.statPerception.value)),
      intelligence: String(statScore(elements.statIntelligence.value)),
      charisme: String(statScore(elements.statCharisme.value))
    },
    equipment: elements.characterEquipment.value,
    notes: elements.characterNotes.value
  };

  action("saveCharacter", { character });
  elements.sheetEditorCard.classList.add("closed");
  clearCharacterForm();
}

function openCharacter(id) {
  const character = state.characters.find((item) => item.id === id);
  if (!character) {
    return;
  }

  const stats = character.stats || {};
  elements.characterId.value = id;
  elements.characterName.value = character.name || "";
  elements.characterPlayer.value = character.player || "";
  elements.characterArchetype.value = character.archetype || "";
  elements.characterLevel.value = character.level || "";
  const pvMax = metricMaxValue(character.pvMax, 4);
  const staminaMax = metricMaxValue(character.staminaMax, 4);
  elements.characterPvMax.value = String(pvMax);
  elements.characterPv.value = String(metricValue(character.pv, pvMax));
  elements.characterStaminaMax.value = String(staminaMax);
  elements.characterStamina.value = String(metricValue(character.stamina, staminaMax));
  elements.statForce.value = String(statScore(stats.force));
  elements.statAgilite.value = String(statScore(stats.agilite ?? stats.dexterite));
  elements.statResistance.value = String(statScore(stats.resistance ?? stats.defense));
  elements.statPerception.value = String(statScore(stats.perception));
  elements.statIntelligence.value = String(statScore(stats.intelligence ?? stats.esprit ?? stats.magie));
  elements.statCharisme.value = String(statScore(stats.charisme ?? stats.social));
  elements.characterEquipment.value = character.equipment || "";
  elements.characterNotes.value = character.notes || "";
  openCharacterEditor(character.name || "Fiche");
}

function openCharacterEditor(title = "Fiche") {
  elements.sheetEditorTitle.textContent = title;
  elements.sheetEditorCard.classList.remove("closed");
  renderPermissions();
}

function clearCharacterForm() {
  elements.characterForm.reset();
  elements.characterId.value = "";
  elements.characterPv.value = "4";
  elements.characterPvMax.value = "4";
  elements.characterStamina.value = "4";
  elements.characterStaminaMax.value = "4";
  elements.statForce.value = "10";
  elements.statAgilite.value = "10";
  elements.statResistance.value = "10";
  elements.statPerception.value = "10";
  elements.statIntelligence.value = "10";
  elements.statCharisme.value = "10";
  elements.sheetEditorTitle.textContent = "Nouvelle fiche";
}

function setCharacterFormReadonly(readonly) {
  const fields = elements.characterForm.querySelectorAll("input:not([type='hidden']), textarea");
  fields.forEach((field) => {
    field.disabled = readonly;
  });
}

function isMj() {
  return session?.role === "MJ";
}

function canRollNow() {
  if (!session || !state) {
    return false;
  }

  return isMj() || state.turn?.id === session.clientId;
}

function currentPlayer() {
  return state?.participants?.find((player) => player.id === session?.clientId) || null;
}

function setAvatar(element, name, color = "#69746d") {
  element.textContent = initials(name);
  element.style.setProperty("--avatar-color", color || "#69746d");
}

function initials(name) {
  const parts = String(name || "?")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (parts.length === 0) {
    return "?";
  }

  return parts.map((part) => part[0]).join("").toUpperCase();
}

function shortTokenName(name) {
  const clean = String(name || "Pion").trim();
  if (clean.length <= 10) {
    return clean;
  }
  return `${clean.slice(0, 8)}..`;
}

function compactText(value) {
  const clean = String(value || "").replace(/\s+/g, " ").trim();
  if (clean.length <= 78) {
    return clean;
  }
  return `${clean.slice(0, 76)}..`;
}

function syncField(field, value) {
  if (!field) {
    return;
  }

  if (document.activeElement === field) {
    return;
  }
  field.value = String(value ?? "");
}

function normalizeClockTimeClient(value) {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return "08:00";
  }

  const hours = clamp(Number(match[1]), 0, 23);
  const minutes = clamp(Number(match[2]), 0, 59);
  return `${String(Math.trunc(hours)).padStart(2, "0")}:${String(Math.trunc(minutes)).padStart(2, "0")}`;
}

function clockMomentLabel(time) {
  const hour = Number(normalizeClockTimeClient(time).slice(0, 2));
  if (hour >= 5 && hour < 12) {
    return "Matin";
  }
  if (hour >= 12 && hour < 18) {
    return "Apres-midi";
  }
  if (hour >= 18 && hour < 22) {
    return "Soir";
  }
  return "Nuit";
}

function updateSceneThreatValue() {
  if (!elements.sceneThreatValue || !elements.sceneThreatInput) {
    return;
  }

  elements.sceneThreatValue.textContent = `${elements.sceneThreatInput.value}/6`;
}

function moodLabel(mood) {
  const labels = {
    donjon: "Donjon",
    foret: "Foret",
    taverne: "Taverne",
    combat: "Combat",
    mystique: "Mystique",
    nuit: "Nuit"
  };
  return labels[mood] || "Donjon";
}

function fxLabel(type) {
  const labels = {
    runes: "Runes anciennes",
    feu: "Braises de combat",
    eclair: "Coup de tonnerre",
    brume: "Brume de scene"
  };
  return labels[type] || "Effet MJ";
}

function participantColor(name) {
  const clean = String(name || "").trim().toLowerCase();
  if (!clean) {
    return null;
  }

  const match = state?.participants?.find((player) => player.name.trim().toLowerCase() === clean);
  return match?.color || null;
}

function colorFromString(value) {
  const palette = ["#c73535", "#38b58b", "#4b7bea", "#e6b84a", "#8a65c8", "#2f9e7e"];
  const text = String(value || "personnage");
  let score = 0;
  for (let index = 0; index < text.length; index += 1) {
    score = (score + text.charCodeAt(index) * (index + 3)) % 997;
  }
  return palette[score % palette.length];
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function metricMaxValue(value, fallback = 4) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(12, Math.max(1, parsed));
}

function metricValue(value, max = 4) {
  const limit = metricMaxValue(max, 4);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return limit;
  }
  return Math.min(limit, Math.max(0, parsed));
}

function metricToneClass(value, max = 4) {
  const limit = metricMaxValue(max, 4);
  const current = metricValue(value, limit);
  if (current <= 0) {
    return "metric-empty";
  }
  const ratio = current / limit;
  if (ratio <= 0.25) {
    return "metric-critical";
  }
  if (ratio <= 0.5) {
    return "metric-low";
  }
  return "";
}

function metricPips(value, max = 4) {
  const limit = metricMaxValue(max, 4);
  const active = metricValue(value, limit);
  return Array.from({ length: limit }, (_, index) => `<span class="${index < active ? "filled" : ""}"></span>`).join("");
}

function metricPercent(value, max = 4) {
  const limit = metricMaxValue(max, 4);
  return Math.round((metricValue(value, limit) / limit) * 100);
}

function formatTime(value) {
  return new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function debounce(callback, delay) {
  let timeout = null;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => callback(...args), delay);
  };
}

function clamp(number, min, max) {
  const parsed = Number(number);
  if (!Number.isFinite(parsed)) {
    return min;
  }
  return Math.min(max, Math.max(min, parsed));
}

function normalizeHexColor(value) {
  const color = String(value || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(color)) {
    return color.toLowerCase();
  }
  return null;
}

function rgbToHex(red, green, blue) {
  return `#${[red, green, blue]
    .map((value) => clamp(Number(value), 0, 255).toString(16).padStart(2, "0"))
    .join("")}`;
}
