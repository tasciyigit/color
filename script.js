// --- P2P Network Logic ---
let peer = null;
let connections = {}; // guest_id -> DataConnection
let myNickname = "Misafir";
let isHost = false;
let myPeerId = null;

// --- Match State ---
let gameState = {
    isMultiplayer: false,
    gameMode: 'classic', // classic | cumulative
    scoreLimit: 3,
    currentRound: 0,
    targetColor: { h:0, s:0, l:0 },
    players: {} // { [peerId]: { name, score, currentAcc: null, isHost } }
};

// Local UI state
let localGuess = { h: 180, s: 50, l: 50 };
let gameTimer = null;
let resultTimer = null;
let roundTimeoutTimer = null; // Backend Kahoot timer array
let guessVisTimer = null; // Visual ticking timer
window.currentGuessTimeLeft = 20; // Global reference for fast guess bonus

// DOM Elements
const screens = {
    home: document.getElementById('home-screen'),
    lobby: document.getElementById('lobby-screen'),
    color: document.getElementById('color-screen'),
    guess: document.getElementById('guess-screen'),
    roundResult: document.getElementById('round-result-screen'),
    matchResult: document.getElementById('match-result-screen'),
    soloResult: document.getElementById('solo-result-screen')
};

const elems = {
    logo: document.getElementById('logo'),
    liveScoreboard: document.getElementById('live-scoreboard'),
    
    waitingOverlay: document.getElementById('waiting-overlay'),
    waitingSubtext: document.getElementById('waiting-subtext'),

    // Lobby
    nicknameInput: document.getElementById('nickname-input'),
    lobbyCode: document.getElementById('lobby-code-display'),
    lobbyStatus: document.getElementById('lobby-status'),
    lobbyPlayersList: document.getElementById('lobby-players-list'),
    lobbyPlayerCount: document.getElementById('lobby-player-count'),
    hostControls: document.getElementById('host-controls'),
    gameModeSelect: document.getElementById('game-mode-select'),
    targetScoreInput: document.getElementById('target-score-input'),
    startBtnCount: document.getElementById('start-btn-count'),
    
    // Round Results
    roundTitle: document.getElementById('round-title'),
    roundSubtitle: document.getElementById('round-subtitle'),
    roundLeaderboard: document.getElementById('round-leaderboard-container'),
    roundTimerText: document.getElementById('round-timer'),
    
    // Match Results
    matchWinnerText: document.getElementById('match-winner-text'),
    finalLeaderboard: document.getElementById('final-leaderboard-container'),
    
    // Colors
    targetDisplay: document.getElementById('target-color-display'),
    guessDisplay: document.getElementById('guess-color-preview'),
    countdown: document.getElementById('countdown'),
    
    // Misc
    notification: document.getElementById('notification'),
    shareModal: document.getElementById('share-modal'),
    shareText: document.getElementById('share-text')
};

let nicknameActionCallback = null;

function init() {
    // Check locally saved nickname
    const savedName = localStorage.getItem('renk_nickname');
    if (savedName) document.getElementById('nickname-input').value = savedName;

    // Buttons
    document.getElementById('btn-solo').addEventListener('click', startSoloMatch);
    
    document.getElementById('btn-multi-create').addEventListener('click', () => {
        promptNicknameAndExecute(() => createRoom());
    });

    document.getElementById('btn-join-room').addEventListener('click', () => {
        const code = document.getElementById('join-room-input').value.trim().toUpperCase();
        if (code.length > 0) {
            promptNicknameAndExecute(() => joinRoom(code));
        } else {
            showNotification("Geçerli bir kod girin");
        }
    });

    document.getElementById('btn-nickname-cancel').addEventListener('click', () => {
        document.getElementById('nickname-modal').classList.add('hidden');
        nicknameActionCallback = null;
    });

    document.getElementById('btn-nickname-confirm').addEventListener('click', () => {
        const val = document.getElementById('nickname-input').value.trim();
        if (val.length < 2) {
            showNotification("Lütfen 2 karakterden uzun bir isim girin.");
            return;
        }
        myNickname = val;
        localStorage.setItem('renk_nickname', val);
        document.getElementById('nickname-modal').classList.add('hidden');
        if (nicknameActionCallback) {
            nicknameActionCallback();
            nicknameActionCallback = null;
        }
    });
    
    document.getElementById('btn-start-match').addEventListener('click', () => {
        if(isHost) {
            gameState.scoreLimit = parseInt(elems.targetScoreInput.value) || 3;
            gameState.gameMode = elems.gameModeSelect.value;
            gameState.currentRound = 0;
            // reset all scores
            Object.values(gameState.players).forEach(p => { p.score = 0; p.currentAcc = null; });
            startNewRound();
        }
    });

    elems.gameModeSelect.addEventListener('change', () => {
        if (elems.gameModeSelect.value === 'classic') {
            document.getElementById('target-score-label').innerText = "Kazanma Puanı:";
            elems.targetScoreInput.value = 3;
        } else {
            document.getElementById('target-score-label').innerText = "Oynanacak Tur Sayısı:";
            elems.targetScoreInput.value = 5;
        }
        broadcastLobbyUpdate();
    });

    document.getElementById('target-score-input').addEventListener('change', broadcastLobbyUpdate);

    document.getElementById('btn-submit').addEventListener('click', submitGuess);
    elems.logo.addEventListener('click', goHome);
    document.getElementById('btn-home-match').addEventListener('click', goHome);
    
    // Web Share
    document.getElementById('btn-share').addEventListener('click', shareResult);
    document.getElementById('btn-close-modal').addEventListener('click', () => elems.shareModal.classList.add('hidden'));
    document.getElementById('btn-copy-modal').addEventListener('click', copyShareText);
    
    // Solo Buttons
    document.getElementById('btn-solo-play-again').addEventListener('click', startSoloMatch);
    document.getElementById('btn-solo-home').addEventListener('click', goHome);
    document.getElementById('btn-solo-share').addEventListener('click', shareSoloResult);

    // Sliders
    ['h', 's', 'l'].forEach(key => {
        document.getElementById(`slider-${key}`).addEventListener('input', (e) => {
            localGuess[key] = parseInt(e.target.value);
            updateGuessPreview();
        });
    });

    // Check URL params
    const urlParams = new URLSearchParams(window.location.search);
    const roomFromUrl = urlParams.get('oda');
    if (roomFromUrl) {
        document.getElementById('join-room-input').value = roomFromUrl;
        showNotification("Lütfen bir oyuncu adı girip Katıl tuşuna basın.");
    }
}

function promptNicknameAndExecute(callback) {
    nicknameActionCallback = callback;
    document.getElementById('nickname-modal').classList.remove('hidden');
    document.getElementById('nickname-input').focus();
}

function showNotification(msg) {
    elems.notification.innerText = msg;
    elems.notification.classList.remove('hidden');
    setTimeout(() => elems.notification.classList.add('hidden'), 3500);
}

function switchScreen(screenId) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[screenId].classList.add('active');
}

function stringifyHSL(h, s, l) { return `hsl(${h}, ${s}%, ${l}%)`; }

function circularDiff(a, b, maxField) {
    let diff = a - b;
    if (diff > maxField / 2) diff -= maxField;
    if (diff < -maxField / 2) diff += maxField;
    return diff;
}

function animateValue(obj, start, end, duration) {
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        obj.innerHTML = Math.floor(progress * (end - start) + start) + "%";
        if (progress < 1) window.requestAnimationFrame(step);
    };
    window.requestAnimationFrame(step);
}

function goHome() {
    clearInterval(gameTimer);
    clearInterval(resultTimer);
    clearTimeout(roundTimeoutTimer);
    cleanupPeer();
    
    window.history.replaceState({}, '', window.location.pathname);
    gameState.isMultiplayer = false;
    elems.waitingOverlay.classList.add('hidden');
    
    switchScreen('home');
}

// ------ PEERJS DATABASE & NETWORK ------

function cleanupPeer() {
    Object.values(connections).forEach(c => c.close());
    connections = {};
    if (peer) { peer.destroy(); peer = null; }
}

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
}

// HOST LOGIC
function createRoom() {
    const code = generateRoomCode();
    window.history.replaceState({}, '', `?oda=${code}`);
    
    showOverlay("Oda Oluşturuluyor...");
    
    peer = new Peer(`renk-game-${code}`);
    
    peer.on('open', (id) => {
        hideOverlay();
        isHost = true;
        myPeerId = id;
        gameState.isMultiplayer = true;
        gameState.players = {};
        
        // Add self
        gameState.players[myPeerId] = { name: myNickname, score: 0, currentAcc: null, connected: true, isHost: true };
        
        elems.lobbyCode.innerText = code;
        elems.lobbyStatus.innerText = "Bağlantı kuruldu, arkadaşlarının koda girmesi bekleniyor...";
        elems.lobbyStatus.style.color = "var(--text-muted)";
        elems.hostControls.classList.remove('hidden');
        renderLobbyPlayers();
        switchScreen('lobby');
    });

    peer.on('connection', (conn) => {
        conn.on('open', () => {
            connections[conn.peer] = conn;
            conn.on('data', (data) => handleHostData(conn.peer, data));
            conn.on('close', () => handleGuestDisconnect(conn.peer));
        });
    });

    peer.on('error', (err) => {
        hideOverlay();
        if(err.type === 'unavailable-id') showNotification("Bu oda kodu zaten alınmış.");
        else showNotification("Hata oluştu: " + err.type);
        goHome();
    });
}

function handleHostData(peerId, data) {
    if (data.type === 'JOIN_REQ') {
        // Add player
        gameState.players[peerId] = { name: data.payload.name, score: 0, currentAcc: null, connected: true, isHost: false };
        
        // Acknowledge
        connections[peerId].send({ type: 'ROOM_JOINED_ACK', payload: { roomCode: document.getElementById('join-room-input').value.trim() || elems.lobbyCode.innerText, myId: peerId } });
        
        showNotification(`${data.payload.name} odaya katıldı!`);
        broadcastLobbyUpdate();
    }
    
    if (data.type === 'GUEST_GUESS') {
        if(gameState.players[peerId]) {
            gameState.players[peerId].currentAcc = data.payload.score;
            checkRoundReady(false);
        }
    }
}

function handleGuestDisconnect(peerId) {
    if(gameState.players[peerId]) {
        showNotification(`${gameState.players[peerId].name} ayrıldı!`);
        gameState.players[peerId].connected = false;
        
        // Cleanup connections array
        delete connections[peerId];
        delete gameState.players[peerId]; // completely remove to avoid blocking round
        
        broadcastLobbyUpdate();
        checkRoundReady(false); // In case we were waiting on them
    }
}

function broadcastLobbyUpdate() {
    if(!isHost) return;
    renderLobbyPlayers();
    
    const payload = { 
        players: gameState.players, 
        gameMode: elems.gameModeSelect.value, 
        scoreLimit: parseInt(elems.targetScoreInput.value) || 3
    };
    
    Object.values(connections).forEach(c => {
        if(c.open) c.send({ type: 'LOBBY_UPDATE', payload });
    });
}

// GUEST LOGIC
function joinRoom(code) {
    window.history.replaceState({}, '', `?oda=${code}`);
    showOverlay("Odaya Bağlanılıyor...");
    
    peer = new Peer();
    peer.on('open', (id) => {
        myPeerId = id;
        const connObj = peer.connect(`renk-game-${code}`);
        
        connObj.on('open', () => {
            connections['host'] = connObj; // Guest only has 1 connection, the host
            connObj.send({ type: 'JOIN_REQ', payload: { name: myNickname } });
        });

        connObj.on('data', (data) => handleGuestData(data));
        connObj.on('close', () => {
            showNotification("Kurucu oyundan ayrıldı, oda kapandı.");
            goHome();
        });
    });

    peer.on('error', (err) => {
        hideOverlay();
        if (err.type === 'peer-unavailable') showNotification(code + " odası bulunamadı.");
        else showNotification("Bağlantı hatası: " + err.type);
        goHome();
    });
}

function handleGuestData(data) {
    console.log("Guest RECV:", data.type);
    if (data.type === 'ROOM_JOINED_ACK') {
        hideOverlay();
        isHost = false;
        gameState.isMultiplayer = true;
        
        elems.lobbyCode.innerText = data.payload.roomCode;
        elems.lobbyStatus.innerText = "Odaya bağlandın. Maçın sahibinin başlatması bekleniyor...";
        elems.lobbyStatus.style.color = "var(--win)";
        elems.hostControls.classList.add('hidden');
        switchScreen('lobby');
    }
    else if (data.type === 'LOBBY_UPDATE') {
        gameState.players = data.payload.players;
        gameState.gameMode = data.payload.gameMode;
        gameState.scoreLimit = data.payload.limit;
        renderLobbyPlayers();
        // Update Read-only settings
        let mTranslate = gameState.gameMode === 'classic' ? 'Klasik (Puanlı)' : 'Kümülatif (Yüzde Toplama)';
        if(gameState.gameMode === 'speedKahoot') mTranslate = 'Hızlı Kahoot (Yüzde + Zaman Bonusu)';
        
        elems.lobbyStatus.innerHTML = `<div>Host ayarları güncelledi.</div><div style="margin-top:0.5rem; font-size:0.9rem; color:var(--text-muted);"><b style="color:#fff;">Oyun Modu:</b> ${mTranslate}<br/><b style="color:#fff;">Hedef:</b> ${data.payload.scoreLimit}</div>`;
    }
    else if (data.type === 'START_ROUND') {
        handleStartRoundPhase(data.payload);
    }
    else if (data.type === 'ROUND_RESULT') {
        handleRoundResult(data.payload);
    }
    else if (data.type === 'MATCH_RESULT') {
        handleMatchResult(data.payload);
    }
}

// ------ LOBBY RENDER ------

function renderLobbyPlayers() {
    elems.lobbyPlayersList.innerHTML = '';
    const arr = Object.values(gameState.players);
    elems.lobbyPlayerCount.innerText = arr.length;
    if(isHost) elems.startBtnCount.innerText = arr.length;

    arr.forEach(p => {
        const li = document.createElement('li');
        li.className = 'lobby-player-pill';
        li.innerText = p.name + (p.isHost ? ' 👑' : '');
        elems.lobbyPlayersList.appendChild(li);
    });
}

// ------ GAME LOGIC ------

function startSoloMatch() {
    isHost = true;
    gameState.isMultiplayer = false;
    myPeerId = 'solo';
    gameState.players[myPeerId] = { name: "Sen", score: 0, currentAcc: null };
    startNewRound();
}

function startNewRound() {
    gameState.currentRound++;
    
    // Clear guesses
    Object.values(gameState.players).forEach(p => p.currentAcc = null);
    
    gameState.targetColor = {
        h: Math.floor(Math.random() * 360),
        s: Math.floor(Math.random() * 70) + 30,
        l: Math.floor(Math.random() * 60) + 20 
    };

    const payload = {
        targetColor: gameState.targetColor,
        players: gameState.players,
        gameMode: gameState.gameMode,
        limit: gameState.scoreLimit,
        round: gameState.currentRound
    };

    if (gameState.isMultiplayer) {
        Object.values(connections).forEach(c => {
            if(c.open) c.send({ type: 'START_ROUND', payload });
        });
    }

    handleStartRoundPhase(payload);
}

function handleStartRoundPhase(payload) {
    gameState.targetColor = payload.targetColor;
    gameState.scoreLimit = payload.limit;
    gameState.gameMode = payload.gameMode;
    gameState.players = payload.players;
    gameState.currentRound = payload.round;

    // Reset Guess UI
    localGuess = { h: 180, s: 50, l: 50 };
    document.getElementById('slider-h').value = localGuess.h;
    document.getElementById('slider-s').value = localGuess.s;
    document.getElementById('slider-l').value = localGuess.l;
    updateGuessPreview();

    // Show color
    document.getElementById('guess-timer-display').classList.add('hidden');
    elems.targetDisplay.style.backgroundColor = `hsl(${gameState.targetColor.h}, ${gameState.targetColor.s}%, ${gameState.targetColor.l}%)`;
    switchScreen('color');

    // Countdown
    let timeLeft = 3;
    elems.countdown.innerText = timeLeft;
    elems.countdown.style.opacity = '1';

    clearInterval(gameTimer);
    gameTimer = setInterval(() => {
        timeLeft--;
        if (timeLeft > 0) elems.countdown.innerText = timeLeft;
        else if (timeLeft === 0) elems.countdown.style.opacity = '0';
        else {
            clearInterval(gameTimer);
            switchScreen('guess');
            
            // Start local visual timer (only in multiplayer)
            if (gameState.isMultiplayer) {
                startVisualGuessTimer();
            }
            
            // Timeout safety layer for multiplayer (20 seconds) Kahoot timer
            if (isHost && gameState.isMultiplayer) {
                clearTimeout(roundTimeoutTimer);
                roundTimeoutTimer = setTimeout(() => {
                    checkRoundReady(true); // force finish round
                }, 20000); 
            }
        }
    }, 1000);
}

function startVisualGuessTimer() {
    const dObj = document.getElementById('guess-timer-display');
    dObj.classList.remove('hidden');
    dObj.style.color = "var(--text-muted)";
    
    window.currentGuessTimeLeft = 20;
    dObj.innerText = `00:${window.currentGuessTimeLeft}`;
    
    clearInterval(guessVisTimer);
    guessVisTimer = setInterval(() => {
        window.currentGuessTimeLeft--;
        if (window.currentGuessTimeLeft >= 0) {
            dObj.innerText = `00:${window.currentGuessTimeLeft < 10 ? '0'+window.currentGuessTimeLeft : window.currentGuessTimeLeft}`;
            if (window.currentGuessTimeLeft <= 5) {
                dObj.style.color = "var(--lose)";
            }
        } else {
            clearInterval(guessVisTimer);
            dObj.innerText = `00:00`;
        }
    }, 1000);
}

function submitGuess() {
    const accuracy = calculateAccuracy(localGuess, gameState.targetColor);
    
    // speedKahoot time bonus calculation
    const timeBonus = Math.floor(window.currentGuessTimeLeft / 2);
    const finalScore = gameState.gameMode === 'speedKahoot' ? (accuracy + timeBonus) : accuracy;
    
    if (!gameState.isMultiplayer) {
        handleSoloResult(accuracy);
        return;
    }

    // Multiplayer Logic
    if (isHost) {
        gameState.players[myPeerId].currentAcc = finalScore;
        clearInterval(guessVisTimer);
        document.getElementById('guess-timer-display').innerText = "Bekleniyor...";
        checkRoundReady(false);
        showOverlay("Diğer oyuncuların tahmini bekleniyor...");
    } else {
        connections['host'].send({ type: 'GUEST_GUESS', payload: { score: finalScore } });
        clearInterval(guessVisTimer);
        document.getElementById('guess-timer-display').innerText = "Bekleniyor...";
        showOverlay("Diğer oyuncular bekleniyor...");
    }
}

// Only Host executes this
function checkRoundReady(forceComplete = false) {
    const pIds = Object.keys(gameState.players).filter(id => gameState.players[id].connected !== false);
    
    const allGuessed = pIds.every(id => gameState.players[id].currentAcc !== null);
    
    if (allGuessed || forceComplete) {
        clearTimeout(roundTimeoutTimer);
        
        // Zero out non-guessers if forced
        if (forceComplete) {
            pIds.forEach(id => {
                if (gameState.players[id].currentAcc === null) gameState.players[id].currentAcc = 0;
            });
        }
        
        // Rank logic
        let rankedDict = {};
        pIds.forEach(id => {
            rankedDict[id] = { id, acc: gameState.players[id].currentAcc, name: gameState.players[id].name };
        });
        
        let rankedArray = Object.values(rankedDict).sort((a,b) => b.acc - a.acc);
        
        let matchOver = false;

        // Scoring rules
        if (gameState.gameMode === 'classic') {
            // Give 1 point to top player(s)
            const topAcc = rankedArray[0].acc;
            rankedArray.forEach(p => {
                if(p.acc === topAcc) gameState.players[p.id].score += 1;
            });
            // check limit
            if(rankedArray.some(p => gameState.players[p.id].score >= gameState.scoreLimit)) matchOver = true;
            
        } else {
            // cumulative and speedKahoot
            rankedArray.forEach(p => {
                gameState.players[p.id].score += p.acc;
            });
             if(gameState.currentRound >= gameState.scoreLimit) matchOver = true;
        }

        // Generate full sorted ranked list for round
        let fullRankList = Object.keys(gameState.players).map(id => {
            return {
                id: id,
                name: gameState.players[id].name,
                roundAcc: gameState.players[id].currentAcc,
                totalScore: gameState.players[id].score
            }
        });
        
        // Sort primarily by Total Score, then by Round Acc
        fullRankList.sort((a, b) => b.totalScore - a.totalScore || b.roundAcc - a.roundAcc);

        const payload = {
            players: gameState.players,
            leaderboard: fullRankList,
            matchOver: matchOver,
            gameMode: gameState.gameMode,
            limit: gameState.scoreLimit,
            round: gameState.currentRound
        };

        if (matchOver) {
            clearInterval(guessVisTimer);
            if(gameState.isMultiplayer) Object.values(connections).forEach(c => c.open && c.send({ type: 'MATCH_RESULT', payload }));
            handleMatchResult(payload);
        } else {
            clearInterval(guessVisTimer);
            if(gameState.isMultiplayer) Object.values(connections).forEach(c => c.open && c.send({ type: 'ROUND_RESULT', payload }));
            handleRoundResult(payload);
        }
    }
}

function renderLeaderboard(containerId, list, isMatchResult) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    
    list.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'leaderboard-item';
        if (item.id === myPeerId) div.classList.add('is-me');
        
        const rankIdx = index + 1;
        
        div.innerHTML = `
            <div class="rank">#${rankIdx}</div>
            <div class="player-info">
                <div class="name">${item.name}</div>
                <div class="round-acc">${isMatchResult ? '' : ('Turu: ' + item.roundAcc + '%')}</div>
            </div>
            <div style="display:flex; flex-direction:column; align-items:flex-end;">
                <span class="score-label">${gameState.gameMode === 'classic' ? 'Puan' : 'Toplam'}</span>
                <span class="score">${item.totalScore}</span>
            </div>
        `;
        container.appendChild(div);
    });
}

function handleRoundResult(payload) {
    hideOverlay();
    switchScreen('roundResult');
    gameState.players = payload.players;
    
    renderLeaderboard('round-leaderboard-container', payload.leaderboard, false);

    // Auto next round timer
    let waitSecs = 8;
    elems.roundTimerText.innerText = `Sonraki tur ${waitSecs} saniye içinde başlıyor...`;
    
    clearInterval(resultTimer);
    resultTimer = setInterval(() => {
        waitSecs--;
        if(waitSecs > 0) elems.roundTimerText.innerText = `Sonraki tur ${waitSecs} saniye içinde başlıyor...`;
        else {
            clearInterval(resultTimer);
            if(isHost) startNewRound();
        }
    }, 1000);
}

function handleMatchResult(payload) {
    hideOverlay();
    switchScreen('matchResult');
    gameState.players = payload.players;
    
    renderLeaderboard('final-leaderboard-container', payload.leaderboard, true);
    
    // Check if I won
    const winnerId = payload.leaderboard[0].id; // The sorted first
    if(winnerId === myPeerId) {
        elems.matchWinnerText.innerText = "Şampiyon Sensin! 🏆";
        elems.matchWinnerText.style.color = "var(--win)";
    } else {
        elems.matchWinnerText.innerText = `Kazanan: ${payload.leaderboard[0].name} 👑`;
        elems.matchWinnerText.style.color = "var(--text-primary)";
    }

    // Save for sharing
    window.matchShareData = { 
        iWon: winnerId === myPeerId, 
        myScore: payload.leaderboard.find(x=>x.id === myPeerId).totalScore, 
        winnerName: payload.leaderboard[0].name,
        limit: payload.limit 
    };
}

// ------ SOLO CODE ------
function handleSoloResult(accuracy) {
    hideOverlay();
    switchScreen('soloResult');
    
    document.getElementById('solo-result-target').style.backgroundColor = stringifyHSL(gameState.targetColor.h, gameState.targetColor.s, gameState.targetColor.l);
    document.getElementById('solo-result-guess').style.backgroundColor = stringifyHSL(localGuess.h, localGuess.s, localGuess.l);
    
    window.lastScore = accuracy;
    animateValue(document.getElementById('solo-final-score'), 0, accuracy, 1000);
    
    let hDiff = circularDiff(localGuess.h, gameState.targetColor.h, 360);
    let sDiff = localGuess.s - gameState.targetColor.s;
    let lDiff = localGuess.l - gameState.targetColor.l;
    
    setSoloStatBar('h', hDiff, 180, '');
    setSoloStatBar('s', sDiff, 100, '%');
    setSoloStatBar('l', lDiff, 100, '%');
}

function setSoloStatBar(id, diff, maxVal, unit) {
    const bar = document.getElementById(`solo-bar-${id}`);
    const valText = document.getElementById(`solo-diff-${id}`);
    
    if (diff > 0) {
        bar.style.left = '50%'; bar.style.width = `${(Math.abs(diff)/maxVal)*50}%`;
    } else {
        bar.style.left = `${50 - (Math.abs(diff)/maxVal)*50}%`; bar.style.width = `${(Math.abs(diff)/maxVal)*50}%`;
    }
    
    if (diff === 0) {
        valText.innerText = `0${unit}`;
        bar.style.backgroundColor = 'var(--text-muted)'; valText.style.color = 'var(--text-muted)';
        bar.style.left = '49%'; bar.style.width = '2%';
    } else if (diff > 0) {
        valText.innerText = `+${diff}${unit}`;
        bar.style.backgroundColor = 'var(--win)'; valText.style.color = 'var(--win)';
    } else {
        valText.innerText = `${diff}${unit}`;
        bar.style.backgroundColor = 'var(--lose)'; valText.style.color = 'var(--lose)';
    }
}

// ------ HELPERS ------
function updateGuessPreview() {
    const { h, s, l } = localGuess;
    elems.guessDisplay.style.backgroundColor = `hsl(${h}, ${s}%, ${l}%)`;
    document.getElementById('val-h').innerText = h;
    document.getElementById('val-s').innerText = s + '%';
    document.getElementById('val-l').innerText = l + '%';

    document.getElementById('slider-h').style.background = `linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)`;
    document.getElementById('slider-s').style.background = `linear-gradient(to right, hsl(${h}, 0%, ${l}%), hsl(${h}, 100%, ${l}%))`;
    document.getElementById('slider-l').style.background = `linear-gradient(to right, hsl(${h}, ${s}%, 0%), hsl(${h}, ${s}%, 50%), hsl(${h}, ${s}%, 100%))`;
}

function calculateAccuracy(guess, target) {
    let diff = guess.h - target.h;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;

    const hPct = Math.abs(diff) / 180;
    const sPct = Math.abs(guess.s - target.s) / 100;
    const lPct = Math.abs(guess.l - target.l) / 100;

    const error = (hPct * 0.5) + (sPct * 0.25) + (lPct * 0.25);
    return Math.max(0, Math.round((1 - error) * 100));
}

function showOverlay(text) { elems.waitingSubtext.innerText = text; elems.waitingOverlay.classList.remove('hidden'); }
function hideOverlay() { elems.waitingOverlay.classList.add('hidden'); }

function shareResult() {
    const data = window.matchShareData || {};
    const textStatus = data.iWon ? "Şampiyon oldum!" : `${data.winnerName} kazandı ama rekabetçiydim.`;
    const base = window.location.origin + window.location.pathname;
    let text = `🎨 Renk Hafıza Oyunu\n\nEkiple oynadık ve ${textStatus}\nToplam Skorum: ${data.myScore}\n\nSen de oyna:\n${base}`;

    if (navigator.share) {
        navigator.share({ title: 'Renk Hafıza', text: text }).catch(() => fallbackShare(text));
    } else fallbackShare(text);
}

function shareSoloResult() {
    const base = window.location.origin + window.location.pathname;
    let text = `🎨 Renk Hafıza Oyunu\n\nSolo skorum: %${window.lastScore}\n\nSen de hafızanı test et:\n${base}`;
    if (navigator.share) {
        navigator.share({ title: 'Renk Hafıza Oyunu', text: text }).catch(() => fallbackShare(text));
    } else fallbackShare(text);
}

function fallbackShare(text) {
    elems.shareText.value = text;
    elems.shareModal.classList.remove('hidden');
    document.getElementById('btn-copy-modal').innerText = "Kopyala";
}

function copyShareText() {
    elems.shareText.select();
    navigator.clipboard.writeText(elems.shareText.value).then(() => {
        document.getElementById('btn-copy-modal').innerText = "✅ Kopyalandı!";
        showNotification("Panoya kopyalandı!");
        setTimeout(() => elems.shareModal.classList.add('hidden'), 1500);
    }).catch(() => {
        document.execCommand('copy');
        document.getElementById('btn-copy-modal').innerText = "✅ Kopyalandı!";
    });
}

init();
