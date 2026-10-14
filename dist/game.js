(function () {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const titleOverlay = document.getElementById('titleOverlay');
  const speakerEl = document.getElementById('speaker');
  const storyEl = document.getElementById('storyText');
  const hintEl = document.getElementById('continueHint');
  const choicesEl = document.getElementById('choices');
  const objectiveEl = document.getElementById('objectiveText');
  const roomEl = document.getElementById('roomLabel');
  const timerEl = document.getElementById('timerLabel');
  const alertEl = document.getElementById('alertLabel');
  const noticeEl = document.getElementById('notice');
  const pauseButton = document.getElementById('pauseButton');
  const T = 24, COLS = 20, ROWS = 15;
  const images = {};
  const imageNames = ['student-front', 'student-side', 'student-back', 'librarian', 'owl', 'bookshelf', 'archway', 'spellbook'];
  const palette = { night: '#111c2c', navy: '#1a3040', stone: '#496775', stoneLight: '#6e8a8b', sage: '#a8c5ad', cream: '#f7e7b7', gold: '#e0bd73', red: '#d8897d', snow: '#d1ddc3' };
  const pressed = new Set();
  const touchPressed = new Set();
  let moveClock = 0;
  let guardClock = 0;
  let noticeClock = 0;
  let lastFrame = performance.now();
  let state = null;

  const rooms = {
    courtyard: {
      name: '雪夜庭院', kind: 'snow',
      blocks: [[8, 6, 4, 3], [2, 2, 2, 2], [16, 2, 2, 2]],
      portals: [
        { x: 10, y: 0, to: 'hall', spawn: [10, 13] },
        { x: 10, y: 14, action: 'exit' }
      ],
      things: [
        { id: 'owl', x: 5, y: 10, kind: 'owl', label: '信使猫头鹰' },
        { id: 'statue', x: 14, y: 6, kind: 'statue', label: '蛇形石雕' }
      ]
    },
    hall: {
      name: '城堡走廊', kind: 'stone',
      blocks: [[3, 3, 2, 2], [15, 3, 2, 2], [3, 10, 2, 2], [15, 10, 2, 2], [8, 5, 4, 2]],
      portals: [
        { x: 10, y: 14, to: 'courtyard', spawn: [10, 1] },
        { x: 0, y: 7, to: 'library', spawn: [18, 7] }
      ],
      things: [
        { id: 'caretaker', x: 13, y: 4, kind: 'librarian', label: '值夜管理员' },
        { id: 'noticeboard', x: 17, y: 9, kind: 'board', label: '闭馆告示' }
      ],
      guard: { path: [[6, 7], [14, 7], [14, 10], [6, 10]], x: 6, y: 7 }
    },
    library: {
      name: '图书馆', kind: 'wood',
      blocks: [[3, 3, 3, 4], [8, 3, 3, 4], [13, 3, 3, 4], [3, 10, 3, 3], [8, 10, 3, 3], [13, 10, 3, 3]],
      portals: [
        { x: 19, y: 7, to: 'hall', spawn: [1, 7] },
        { x: 10, y: 0, to: 'annex', spawn: [10, 13], requiresGate: true }
      ],
      things: [
        { id: 'h13', x: 4, y: 3, kind: 'shelf', label: 'H-13 空书架' },
        { id: 'ledger', x: 16, y: 11, kind: 'ledger', label: '借阅台记录' },
        { id: 'librarian', x: 16, y: 3, kind: 'librarian', label: '图书管理员' },
        { id: 'lamp', x: 2, y: 8, kind: 'lamp', label: '青铜阅读灯' }
      ]
    },
    annex: {
      name: '禁书区', kind: 'dark',
      blocks: [[3, 3, 3, 5], [14, 3, 3, 5], [3, 10, 3, 3], [14, 10, 3, 3]],
      portals: [{ x: 10, y: 14, to: 'library', spawn: [10, 1] }],
      things: [
        { id: 'realBook', x: 10, y: 4, kind: 'book', label: '隐匿的蓝金书脊' },
        { id: 'oldNote', x: 7, y: 11, kind: 'note', label: '遗落的羊皮纸' }
      ],
      guard: { path: [[7, 4], [12, 4], [12, 8], [7, 8]], x: 7, y: 4 }
    }
  };

  function createState() {
    return {
      mode: 'playing', room: 'courtyard', player: { x: 10, y: 11, dir: 'up' },
      remaining: 480, strikes: 0, alert: 0, invincible: 0,
      spell: 0, spellCooldown: 0, dialogue: null, autoPath: [],
      flags: { h13: false, ledger: false, gate: false, book: false, note: false },
      guards: {
        hall: { x: 6, y: 7, pathIndex: 0 },
        annex: { x: 7, y: 4, pathIndex: 0 }
      }
    };
  }

  function image(src) {
    const img = new Image();
    img.src = './assets/' + src + '.png';
    images[src] = img;
  }
  imageNames.forEach(image);

  function hash(x, y, salt) {
    let n = (x * 374761393 + y * 668265263 + salt * 1442695041) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return (n ^ (n >>> 16)) >>> 0;
  }

  function fill(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  function drawImage(name, x, y, w, h, flip) {
    const img = images[name];
    if (!img || !img.complete || !img.naturalWidth) return false;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    if (flip) {
      ctx.translate(x + w, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, y, w, h);
    } else ctx.drawImage(img, x, y, w, h);
    ctx.restore();
    return true;
  }

  function isPortal(room, x, y) {
    return rooms[room].portals.some(portal => portal.x === x && portal.y === y);
  }

  function blocked(room, x, y) {
    if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return true;
    if ((x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1) && !isPortal(room, x, y)) return true;
    if (rooms[room].blocks.some(([bx, by, bw, bh]) => x >= bx && x < bx + bw && y >= by && y < by + bh)) return true;
    const occupied = rooms[room].things.some(t => t.x === x && t.y === y && t.id !== 'realBook' && t.id !== 'oldNote');
    return occupied;
  }

  function formatTime(seconds) {
    const value = Math.max(0, Math.ceil(seconds));
    return String(Math.floor(value / 60)).padStart(2, '0') + ':' + String(value % 60).padStart(2, '0');
  }

  function objective() {
    if (!state || state.mode === 'title') return '从庭院进入城堡';
    if (!state.flags.h13) return '进入图书馆，调查 H-13 书架';
    if (!state.flags.ledger) return '查阅借阅台记录，确认调包线索';
    if (!state.flags.gate) return '请图书管理员开启禁书区';
    if (!state.flags.book) return '在禁书区用 F 显影，找到真书';
    return '避开巡逻，带书从庭院大门离开';
  }

  function refreshHud() {
    roomEl.textContent = state && state.mode !== 'title' ? rooms[state.room].name : '雪夜庭院';
    timerEl.textContent = formatTime(state ? state.remaining : 480);
    alertEl.textContent = (state ? state.strikes : 0) + ' / 3';
    objectiveEl.textContent = objective();
    pauseButton.textContent = state && state.mode === 'paused' ? '继续 P' : '暂停 P';
  }

  function notice(text, duration) {
    noticeEl.textContent = text;
    noticeEl.classList.add('visible');
    noticeClock = duration || 2.3;
  }

  function showDialogue(lines, choices) {
    state.dialogue = { lines, index: 0, choices: choices || null };
    state.autoPath = [];
    renderDialogue();
  }

  function renderDialogue() {
    choicesEl.replaceChildren();
    const dialogue = state && state.dialogue;
    if (!dialogue) {
      speakerEl.textContent = '任务手记';
      storyEl.textContent = '靠近人物或发光物件，按 J / Z 互动。点击地图也能自动寻路。';
      hintEl.textContent = '';
      return;
    }
    const line = dialogue.lines[dialogue.index];
    speakerEl.textContent = line.speaker;
    storyEl.textContent = line.text;
    const isLast = dialogue.index === dialogue.lines.length - 1;
    hintEl.textContent = isLast && dialogue.choices ? '请选择' : 'J / Z 继续';
    if (isLast && dialogue.choices) {
      for (const choice of dialogue.choices) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = choice.label;
        button.addEventListener('click', () => {
          state.dialogue = null;
          choice.action();
          if (!state.dialogue) renderDialogue();
          refreshHud();
        });
        choicesEl.appendChild(button);
      }
    }
  }

  function nextDialogue() {
    if (!state || !state.dialogue) return false;
    const dialogue = state.dialogue;
    if (dialogue.index < dialogue.lines.length - 1) {
      dialogue.index++;
      renderDialogue();
    } else if (!dialogue.choices) {
      state.dialogue = null;
      renderDialogue();
    }
    return true;
  }

  function start() {
    state = createState();
    moveClock = 0;
    guardClock = 0;
    titleOverlay.classList.add('hidden');
    showDialogue([
      { speaker: '信使猫头鹰', text: '欢迎来到霍格沃茨！今夜图书馆即将闭馆，可《第十三页》被人调了包。' },
      { speaker: '信使猫头鹰', text: '请在钟声响起前找回真书，从庭院大门离开。路上要避开巡逻的同学。' }
    ]);
    refreshHud();
  }

  function showHelp() {
    if (!state || state.mode === 'title') {
      start();
    }
    showDialogue([
      { speaker: '操作说明', text: '方向键 / WASD 移动；J / Z / 空格与人物或物件互动；F 施放显影咒；P 暂停。手机可用屏幕按钮。' },
      { speaker: '操作说明', text: '依次调查 H-13 书架与借阅台，向管理员取得许可。禁书区的真书只有显影后才能看见。' },
      { speaker: '操作说明', text: '巡逻者会沿走廊移动，靠得太近会被发现。三次被发现或闭馆时间耗尽，调查即告失败。' }
    ]);
  }

  function ending(type) {
    if (!state || state.mode === 'ending') return;
    state.mode = 'ending';
    state.dialogue = null;
    const outcomes = {
      returned: ['归还之书', '你带着真书回到管理员面前，借阅记录恢复了原样。晨光穿过城堡时，没人知道你曾在禁书区冒险。'],
      kept: ['秘密的一页', '你抱着《第十三页》穿过雪夜大门。封面上的星纹仍在闪烁，仿佛下一段故事已经开始。'],
      caught: ['闭馆钟声', '巡逻者发现了你的行踪。图书馆的门在身后关上，这一页故事暂时停在了夜里。'],
      timeout: ['时间已尽', '最后一声钟响划破庭院，图书馆的门锁上了。明夜还有机会重新调查。']
    };
    const [title, description] = outcomes[type];
    titleOverlay.replaceChildren();
    const panel = document.createElement('div');
    panel.className = 'title-panel';
    const kicker = document.createElement('p');
    kicker.className = 'title-kicker';
    kicker.textContent = type === 'returned' || type === 'kept' ? '冒险完成 · 中文结局' : '冒险结束';
    const icon = document.createElement('div');
    icon.className = 'title-sigil';
    icon.textContent = type === 'returned' ? '✦' : type === 'kept' ? '◇' : '☾';
    const heading = document.createElement('h2');
    heading.textContent = title;
    const details = document.createElement('p');
    details.textContent = description;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '重新开始';
    button.addEventListener('click', start);
    panel.append(kicker, icon, heading, details, button);
    titleOverlay.appendChild(panel);
    titleOverlay.classList.remove('hidden');
    speakerEl.textContent = title;
    storyEl.textContent = description;
    hintEl.textContent = '';
    choicesEl.replaceChildren();
    refreshHud();
  }

  function interactWith(thing) {
    const flags = state.flags;
    switch (thing.id) {
      case 'owl':
        showDialogue([{ speaker: '信使猫头鹰', text: flags.book ? '找到书了！庭院南侧就是出口。你的决定，将写下不同的结尾。' : '图书馆在走廊西侧。先检查 H-13 原位，再看看借阅记录。' }]);
        break;
      case 'statue':
        showDialogue([{ speaker: '石雕', text: '冰雪覆盖着蛇形石雕。它的目光似乎指向城堡西侧的图书馆。' }]);
        break;
      case 'caretaker':
        showDialogue([{ speaker: '值夜管理员', text: flags.book ? '你终于找到了那本书。别在走廊停留太久。' : '闭馆前只剩几分钟。走廊西侧是图书馆，那里还有一位管理员值班。' }]);
        break;
      case 'noticeboard':
        showDialogue([{ speaker: '闭馆告示', text: '夜间规定：发现异常藏书，先核对书架编号，再查借阅台，最后由管理员开启禁书区。' }]);
        break;
      case 'h13':
        flags.h13 = true;
        showDialogue([{ speaker: 'H-13 书架', text: '原本应在这里的《第十三页》不见了。书架角落有新落的银色粉末，像是有人匆忙搬走了书。' }]);
        break;
      case 'ledger':
        if (!flags.h13) {
          showDialogue([{ speaker: '借阅台记录', text: '记录很多。先确认空书架的编号，才能查到对应的一页。' }]);
        } else {
          flags.ledger = true;
          showDialogue([
            { speaker: '借阅台记录', text: 'H-13：《第十三页》，蓝金书脊，星纹封面。最近一次调动写着“禁书区待核验”。' },
            { speaker: '调查手记', text: '去请图书管理员开启北侧禁书区。真书的书脊会对显影咒产生反应。' }
          ]);
        }
        break;
      case 'librarian':
        if (!flags.ledger) {
          showDialogue([{ speaker: '图书管理员', text: '没有借阅记录，我不能打开禁书区。先查 H-13 书架和借阅台。' }]);
        } else if (!flags.gate) {
          showDialogue([{ speaker: '图书管理员', text: '你确认了书的编号与调动记录。北门已经解锁；记得用显影咒辨认蓝金书脊。' }]);
          flags.gate = true;
        } else {
          showDialogue([{ speaker: '图书管理员', text: flags.book ? '你拿到了真书。现在从庭院离开吧。' : '禁书区就在北门。小心，夜间巡逻已经开始了。' }]);
        }
        break;
      case 'lamp':
        showDialogue([{ speaker: '青铜阅读灯', text: '灯罩上刻着一行小字：“最真实的文字，往往藏在光照不到的地方。”' }]);
        break;
      case 'oldNote':
        flags.note = true;
        showDialogue([{ speaker: '遗落的羊皮纸', text: '“调包者没把书带出去。他们只是把它藏在最显眼的位置，并让封面隐形。”' }]);
        break;
      case 'realBook':
        if (flags.book) {
          showDialogue([{ speaker: '调查手记', text: '你已经拿到了真正的《第十三页》。' }]);
        } else if (state.spell <= 0) {
          showDialogue([{ speaker: '禁书区', text: '这里仿佛有一处空气微微闪动。按 F 施放显影咒，再仔细调查。' }]);
        } else {
          flags.book = true;
          showDialogue([
            { speaker: '《第十三页》', text: '蓝金书脊从空气里显现出来，封面上的星纹和借阅记录完全一致。你找到了真书！' },
            { speaker: '调查手记', text: '原路返回庭院，从南侧大门离开。巡逻者仍在城堡内。' }
          ]);
        }
        break;
    }
    refreshHud();
  }

  function nearestThing() {
    const things = rooms[state.room].things;
    let best = null, bestDistance = Infinity;
    for (const thing of things) {
      const distance = Math.abs(state.player.x - thing.x) + Math.abs(state.player.y - thing.y);
      if (distance <= 2 && distance < bestDistance) { best = thing; bestDistance = distance; }
    }
    return best;
  }

  function interact() {
    if (!state || state.mode === 'title') { start(); return; }
    if (state.mode === 'ending') { start(); return; }
    if (state.mode === 'paused') { pause(); return; }
    if (nextDialogue()) return;
    const thing = nearestThing();
    if (thing) interactWith(thing);
    else notice('走近人物或发光物件后再互动');
  }

  function spell() {
    if (!state || state.mode !== 'playing' || state.dialogue) return;
    if (state.spellCooldown > 0) { notice('显影咒还在恢复中'); return; }
    state.spell = 8;
    state.spellCooldown = 9;
    if (state.room === 'annex') notice('银色光芒照亮了隐藏的书脊', 2.6);
    else notice('显影咒掠过地面，附近没有隐藏书籍', 2.3);
  }

  function pause() {
    if (!state || state.mode === 'title' || state.mode === 'ending') return;
    if (state.dialogue) { notice('阅读对话时已自动暂停计时'); return; }
    state.mode = state.mode === 'paused' ? 'playing' : 'paused';
    refreshHud();
  }

  function transition(portal) {
    if (portal.action === 'exit') {
      if (!state.flags.book) {
        notice('还没有找回真书，不能现在离开');
        state.player.y = 13;
        return;
      }
      state.player.y = 13;
      showDialogue([{ speaker: '庭院大门', text: '雪夜的出口就在眼前。你要如何处理《第十三页》？' }], [
        { label: '把书交还管理员', action: () => ending('returned') },
        { label: '带着书悄悄离开', action: () => ending('kept') }
      ]);
      return;
    }
    if (portal.requiresGate && !state.flags.gate) {
      state.player.y = 1;
      notice('禁书区上锁了。先查记录并询问管理员');
      return;
    }
    state.room = portal.to;
    state.player.x = portal.spawn[0];
    state.player.y = portal.spawn[1];
    state.autoPath = [];
    state.alert = 0;
    notice('来到' + rooms[state.room].name, 1.2);
    refreshHud();
  }

  function move(dx, dy) {
    if (!state || state.mode !== 'playing' || state.dialogue) return false;
    if (dx !== 0) state.player.dir = dx < 0 ? 'left' : 'right';
    if (dy !== 0) state.player.dir = dy < 0 ? 'up' : 'down';
    const x = state.player.x + dx, y = state.player.y + dy;
    if (blocked(state.room, x, y)) return false;
    state.player.x = x;
    state.player.y = y;
    const portal = rooms[state.room].portals.find(p => p.x === x && p.y === y);
    if (portal) transition(portal);
    return true;
  }

  function findPath(room, start, goal) {
    const queue = [start];
    const seen = new Set([start.join(',')]);
    const parent = new Map();
    let target = goal;
    if (blocked(room, goal[0], goal[1])) {
      const alternatives = [[0, 1], [0, -1], [1, 0], [-1, 0]].map(([dx, dy]) => [goal[0] + dx, goal[1] + dy]);
      target = alternatives.find(([x, y]) => !blocked(room, x, y)) || goal;
    }
    const targetKey = target.join(',');
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head];
      const key = current.join(',');
      if (key === targetKey) {
        const path = [];
        let cursor = key;
        while (cursor !== start.join(',')) {
          const [cx, cy] = cursor.split(',').map(Number);
          path.unshift([cx, cy]);
          cursor = parent.get(cursor);
        }
        return path;
      }
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const nx = current[0] + dx, ny = current[1] + dy;
        const nextKey = nx + ',' + ny;
        if (seen.has(nextKey) || blocked(room, nx, ny)) continue;
        seen.add(nextKey);
        parent.set(nextKey, key);
        queue.push([nx, ny]);
      }
    }
    return [];
  }

  function lineClear(room, a, b) {
    const steps = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
    for (let i = 1; i < steps; i++) {
      const x = Math.round(a.x + (b.x - a.x) * i / steps);
      const y = Math.round(a.y + (b.y - a.y) * i / steps);
      if (blocked(room, x, y)) return false;
    }
    return true;
  }

  function updateGuard(dt) {
    const room = rooms[state.room];
    if (!room.guard) { state.alert = Math.max(0, state.alert - dt * 2); return; }
    const guard = state.guards[state.room];
    guardClock += dt;
    if (guardClock >= 0.32) {
      guardClock = 0;
      const next = room.guard.path[(guard.pathIndex + 1) % room.guard.path.length];
      if (guard.x === next[0] && guard.y === next[1]) guard.pathIndex = (guard.pathIndex + 1) % room.guard.path.length;
      const target = room.guard.path[(guard.pathIndex + 1) % room.guard.path.length];
      guard.x += Math.sign(target[0] - guard.x);
      if (guard.x === target[0]) guard.y += Math.sign(target[1] - guard.y);
    }
    if (state.invincible > 0) { state.alert = 0; return; }
    const distance = Math.abs(guard.x - state.player.x) + Math.abs(guard.y - state.player.y);
    const visible = distance <= 2 && lineClear(state.room, guard, state.player);
    state.alert = Math.max(0, Math.min(1.1, state.alert + (visible ? dt * 0.55 : -dt * 1.5)));
    if (state.alert >= 1.1) {
      state.strikes++;
      state.alert = 0;
      state.invincible = 3;
      state.autoPath = [];
      if (state.strikes >= 3) { ending('caught'); return; }
      state.player.x = state.room === 'hall' ? 10 : 10;
      state.player.y = state.room === 'hall' ? 13 : 13;
      notice('被巡逻者发现！已送回入口（' + state.strikes + ' / 3）', 3);
      refreshHud();
    }
  }

  function drawFloor(room) {
    fill(0, 0, 480, 360, room.kind === 'snow' ? '#899f9b' : room.kind === 'wood' ? '#354852' : '#2a4050');
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const px = x * T, py = y * T, h = hash(x, y, room.kind.length);
        if (room.kind === 'snow') {
          fill(px, py, T, T, h % 5 === 0 ? '#b9cbb5' : '#abc0ae');
          fill(px + 4 + h % 13, py + 3 + (h >>> 4) % 14, 2, 2, '#e5e6c8');
          if (h % 7 === 0) fill(px + 15, py + 17, 4, 1, '#7f9d9d');
        } else if (room.kind === 'wood' || room.kind === 'dark') {
          fill(px, py, T, T, room.kind === 'dark' ? (h % 3 ? '#263d48' : '#2b4650') : (h % 3 ? '#40545a' : '#3a4e55'));
          fill(px, py + 20, T, 1, '#1e3542');
          fill(px + (h % 6), py + 5, 8, 1, '#506665');
        } else {
          fill(px, py, T, T, h % 4 ? '#57717b' : '#607b80');
          fill(px + 1, py + 1, T - 2, T - 2, h % 4 ? '#526d77' : '#5c767c');
          fill(px + 2, py + 2, 4, 1, '#73938e');
        }
      }
    }
  }

  function drawWall(room, x, y) {
    const px = x * T, py = y * T;
    fill(px, py, T, T, room.kind === 'snow' ? '#304b5c' : '#243b4b');
    fill(px, py, T, 4, '#728f8b');
    fill(px + 3, py + 8, 8, 1, '#4d6a73');
    fill(px + 14, py + 17, 6, 1, '#4d6a73');
  }

  function drawArchitecture(room) {
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if ((x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1) && !isPortal(state.room, x, y)) drawWall(room, x, y);
      }
    }
    for (const [bx, by, bw, bh] of room.blocks) {
      if (room.kind === 'wood' || room.kind === 'dark') {
        fill(bx * T, by * T + 12, bw * T, bh * T - 9, '#172a39');
        fill(bx * T + 2, by * T + 1, bw * T - 4, bh * T - 7, '#614b39');
        fill(bx * T + 6, by * T + 7, bw * T - 12, bh * T - 18, '#202e38');
        for (let iy = by * T + 11; iy < (by + bh) * T - 12; iy += 14) {
          for (let ix = bx * T + 8; ix < (bx + bw) * T - 8; ix += 11) fill(ix, iy, 6, 11, ['#d3ac6a', '#829eb0', '#a16d65'][hash(ix, iy, 9) % 3]);
          fill(bx * T + 5, iy + 11, bw * T - 10, 2, '#9a7350');
        }
      } else if (room.kind === 'snow') {
        fill(bx * T, by * T, bw * T, bh * T, '#607c80');
        fill(bx * T + 3, by * T + 3, bw * T - 6, bh * T - 6, '#829d9b');
        fill(bx * T + 8, by * T + 7, bw * T - 16, 5, '#dbe1c7');
      } else {
        fill(bx * T, by * T, bw * T, bh * T, '#253c4a');
        fill(bx * T + 3, by * T + 2, bw * T - 6, bh * T - 4, '#7d9590');
        fill(bx * T + 7, by * T + 6, bw * T - 14, bh * T - 12, '#435f68');
      }
    }
    for (const portal of room.portals) {
      const px = portal.x * T, py = portal.y * T;
      fill(px, py, T, T, portal.requiresGate && !state.flags.gate ? '#5b4b46' : '#d6bb7d');
      fill(px + 3, py + 2, T - 6, T - 2, portal.requiresGate && !state.flags.gate ? '#263747' : '#192e3d');
      fill(px + 9, py + 9, 6, 6, '#ddb966');
    }
  }

  function drawSparkle(px, py, pulse) {
    const size = pulse ? 5 : 3;
    fill(px - 1, py - size, 2, size * 2, '#f3dc91');
    fill(px - size, py - 1, size * 2, 2, '#f3dc91');
    fill(px, py, 1, 1, '#fffbe1');
  }

  function drawThings(room, time) {
    for (const thing of room.things) {
      const px = thing.x * T, py = thing.y * T;
      if (thing.kind === 'owl') drawImage('owl', px - 8, py - 26, 40, 50);
      else if (thing.kind === 'librarian') drawImage('librarian', px - 10, py - 27, 45, 51);
      else if (thing.kind === 'statue') {
        fill(px + 8, py - 17, 9, 34, '#476875');
        fill(px + 5, py - 20, 16, 8, '#83a29b');
        fill(px + 11, py - 24, 5, 6, '#dbc988');
      } else if (thing.kind === 'ledger') {
        fill(px - 5, py + 3, 35, 22, '#684d3b');
        fill(px + 3, py - 3, 20, 14, '#d0ba87');
        fill(px + 7, py, 12, 2, '#5a7281');
      } else if (thing.kind === 'shelf') {
        fill(px - 2, py + 1, 52, 13, '#aa7a4a');
        fill(px + 6, py + 5, 28, 2, '#eadb9b');
      } else if (thing.kind === 'lamp') {
        fill(px + 11, py - 8, 2, 32, '#b59359');
        fill(px + 4, py - 12, 16, 7, '#dfbd69');
        fill(px + 9, py - 9, 6, 4, '#ffedac');
      } else if (thing.kind === 'board' || thing.kind === 'note') {
        fill(px + 4, py + 4, 18, 17, '#d9c693');
        fill(px + 7, py + 8, 12, 1, '#6e7880');
        fill(px + 7, py + 12, 9, 1, '#6e7880');
      } else if (thing.kind === 'book') {
        if (state.flags.book) continue;
        if (state.spell > 0) drawImage('spellbook', px - 7, py - 24, 38, 45);
        else fill(px + 8, py + 8, 8, 8, '#6a8181');
      }
      const shouldGlow = thing.id !== 'realBook' || state.spell > 0;
      if (shouldGlow) drawSparkle(px + 12, py - 5 + Math.sin(time / 320) * 2, Math.sin(time / 250) > 0);
    }
  }

  function drawGuard(guard) {
    const px = guard.x * T, py = guard.y * T;
    for (let i = 1; i <= 3; i++) {
      const alpha = 0.12 - i * 0.02;
      ctx.fillStyle = 'rgba(222,129,106,' + alpha + ')';
      ctx.fillRect((guard.x - i) * T + 2, py + 2, (i * 2 + 1) * T - 4, T - 4);
    }
    fill(px + 5, py + 7, 15, 17, '#924f52');
    fill(px + 8, py + 1, 9, 9, '#e3c797');
    fill(px + 6, py, 13, 4, '#332d3a');
    fill(px + 4, py + 22, 6, 2, '#202433');
    fill(px + 15, py + 22, 6, 2, '#202433');
  }

  function drawPlayer(time) {
    const p = state.player;
    const px = p.x * T, py = p.y * T;
    if (state.invincible > 0 && Math.floor(time / 100) % 2 === 0) return;
    fill(px + 5, py + 21, 14, 3, '#13243499');
    const sprite = p.dir === 'up' ? 'student-back' : p.dir === 'down' ? 'student-front' : 'student-side';
    drawImage(sprite, px - 4, py - 17, 33, 40, p.dir === 'left');
    if (state.spell > 0) drawSparkle(px + 20, py - 17, true);
  }

  function drawTitle(time) {
    fill(0, 0, 480, 360, '#112133');
    for (let i = 0; i < 74; i++) {
      const x = hash(i, 2, 1) % 480, y = hash(i, 3, 2) % 210;
      fill(x, y, i % 8 === 0 ? 3 : 2, 2, i % 6 === 0 ? '#e9d49b' : '#a6c0b2');
    }
    fill(374, 46, 50, 50, '#e3d6a3');
    fill(382, 40, 50, 50, '#112133');
    fill(0, 285, 480, 75, '#a6bcab');
    for (let x = 60; x < 430; x += 62) {
      const height = 85 + hash(x, 8, 2) % 52;
      fill(x, 290 - height, 46, height, '#263d4c');
      fill(x + 9, 272 - height, 27, 19, '#263d4c');
      fill(x + 20, 246 - height, 5, 34, '#263d4c');
      fill(x + 9, 264 - height, 4, 8, '#d5b979');
      fill(x + 30, 264 - height, 4, 8, '#d5b979');
    }
    fill(0, 290, 480, 9, '#607b7e');
    fill(0, 299, 480, 61, '#b5c9b4');
    for (let i = 0; i < 30; i++) {
      const x = hash(i, 12, 4) % 480, y = 303 + hash(i, 15, 2) % 55;
      fill(x, y, 5, 2, '#e2e5c5');
    }
    drawImage('student-back', 55, 241 + Math.sin(time / 420) * 2, 38, 46);
    drawImage('owl', 393, 230, 50, 55);
  }

  function draw(time) {
    ctx.imageSmoothingEnabled = false;
    if (!state || state.mode === 'title') { drawTitle(time); return; }
    const room = rooms[state.room];
    drawFloor(room);
    drawArchitecture(room);
    drawThings(room, time);
    if (room.guard) drawGuard(state.guards[state.room]);
    if (state.autoPath.length) {
      for (const [x, y] of state.autoPath) fill(x * T + 10, y * T + 10, 4, 4, '#efd995');
    }
    drawPlayer(time);
    if (state.mode === 'paused') {
      fill(0, 0, 480, 360, '#0a1522a9');
      ctx.fillStyle = '#f6e7b7';
      ctx.font = 'bold 28px serif';
      ctx.textAlign = 'center';
      ctx.fillText('已暂停', 240, 177);
      ctx.textAlign = 'left';
    }
  }

  function update(dt, time) {
    if (noticeClock > 0) {
      noticeClock -= dt;
      if (noticeClock <= 0) noticeEl.classList.remove('visible');
    }
    if (!state || state.mode !== 'playing' || state.dialogue) return;
    state.remaining -= dt;
    state.spell = Math.max(0, state.spell - dt);
    state.spellCooldown = Math.max(0, state.spellCooldown - dt);
    state.invincible = Math.max(0, state.invincible - dt);
    if (state.remaining <= 0) { ending('timeout'); return; }
    moveClock -= dt;
    if (moveClock <= 0) {
      const all = new Set([...pressed, ...touchPressed]);
      let dx = 0, dy = 0;
      if (all.has('up')) dy = -1;
      else if (all.has('down')) dy = 1;
      else if (all.has('left')) dx = -1;
      else if (all.has('right')) dx = 1;
      if (dx || dy) {
        state.autoPath = [];
        move(dx, dy);
        moveClock = 0.105;
      } else if (state.autoPath.length) {
        const next = state.autoPath.shift();
        const previousRoom = state.room;
        move(Math.sign(next[0] - state.player.x), Math.sign(next[1] - state.player.y));
        if (state.room !== previousRoom) state.autoPath = [];
        moveClock = 0.12;
      }
    }
    updateGuard(dt);
    if (Math.floor(time / 200) !== Math.floor((time - dt * 1000) / 200)) refreshHud();
  }

  function frame(time) {
    const dt = Math.min(0.06, (time - lastFrame) / 1000);
    lastFrame = time;
    update(dt, time);
    draw(time);
    requestAnimationFrame(frame);
  }

  function onKeyDown(event) {
    const key = event.key.toLowerCase();
    const directions = { arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down', arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right' };
    if (directions[key]) {
      event.preventDefault();
      pressed.add(directions[key]);
      return;
    }
    if (['j', 'z', 'enter', ' '].includes(key)) {
      event.preventDefault();
      if (!event.repeat) interact();
    } else if (key === 'f') {
      event.preventDefault();
      if (!event.repeat) spell();
    } else if (key === 'p' || key === 'escape') {
      event.preventDefault();
      if (!event.repeat) pause();
    }
  }

  function onKeyUp(event) {
    const key = event.key.toLowerCase();
    const directions = { arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down', arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right' };
    if (directions[key]) pressed.delete(directions[key]);
  }

  function attachControls() {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', () => { pressed.clear(); touchPressed.clear(); });
    document.getElementById('startButton').addEventListener('click', start);
    document.getElementById('titleHelpButton').addEventListener('click', showHelp);
    document.getElementById('interactButton').addEventListener('click', interact);
    document.getElementById('spellButton').addEventListener('click', spell);
    pauseButton.addEventListener('click', pause);
    for (const button of document.querySelectorAll('[data-dir]')) {
      const direction = button.dataset.dir;
      button.addEventListener('pointerdown', event => { event.preventDefault(); button.setPointerCapture(event.pointerId); touchPressed.add(direction); });
      button.addEventListener('pointerup', event => { event.preventDefault(); touchPressed.delete(direction); });
      button.addEventListener('pointercancel', () => touchPressed.delete(direction));
      button.addEventListener('lostpointercapture', () => touchPressed.delete(direction));
    }
    canvas.addEventListener('pointerdown', event => {
      if (!state || state.mode !== 'playing' || state.dialogue) return;
      const box = canvas.getBoundingClientRect();
      const x = Math.min(COLS - 1, Math.max(0, Math.floor((event.clientX - box.left) * canvas.width / box.width / T)));
      const y = Math.min(ROWS - 1, Math.max(0, Math.floor((event.clientY - box.top) * canvas.height / box.height / T)));
      state.autoPath = findPath(state.room, [state.player.x, state.player.y], [x, y]);
      if (!state.autoPath.length) notice('无法走到这里');
    });
  }

  function boot() {
    attachControls();
    state = { mode: 'title', remaining: 480, strikes: 0, room: 'courtyard' };
    refreshHud();
    requestAnimationFrame(frame);
  }

  window.HogwartsPocket = {
    boot,
    snapshot: () => state ? {
      mode: state.mode, room: state.room,
      player: state.player ? { ...state.player } : null,
      remaining: state.remaining, strikes: state.strikes,
      flags: state.flags ? { ...state.flags } : null,
      dialogue: state.dialogue ? state.dialogue.lines[state.dialogue.index].text : null
    } : null
  };
})();
