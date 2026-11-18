// A self-contained color-sort game. Arrays list ornaments from bottom to top.
const CAPACITY = 4;
const COLORS = [
  { name: '홀리 레드', symbol: '●', className: 'red' },
  { name: '포레스트 그린', symbol: '✦', className: 'green' },
  { name: '윈터 블루', symbol: '◆', className: 'blue' },
  { name: '샴페인 골드', symbol: '▲', className: 'gold' },
  { name: '로즈 핑크', symbol: '♥', className: 'pink' },
];
const STAGES = [
  { id: 'first-snow', name: '첫눈', subtitle: '가볍게 시작해요', tubes: [[0,1,2,0],[1,2,0,1],[2,0,1,2],[],[]] },
  { id: 'winter-forest', name: '겨울 숲', subtitle: '조금 더 신중하게', tubes: [[0,1,2,3],[1,2,3,0],[2,3,0,1],[3,0,1,2],[],[]] },
  { id: 'christmas-night', name: '크리스마스 밤', subtitle: '다섯 가지 빛을 모아요', tubes: [[0,1,2,3],[1,4,3,0],[2,3,4,1],[3,0,1,2],[4,2,0,4],[],[]] },
];
const clone = tubes => tubes.map(tube => tube.slice());

/** Mount a color sort game. Returns a destroy method for view transitions. */
export function mountPuzzle(container, options = {}) {
  if (!(container instanceof HTMLElement)) throw new TypeError('Puzzle container must be an element');
  let stageIndex = Math.max(0, STAGES.findIndex(stage => stage.id === options.stageId));
  let tubes = clone(STAGES[stageIndex].tubes);
  let selected = null;
  let history = [];
  let completed = false;
  let message = '같은 색의 장식을 한 병에 모아 주세요.';
  // Keep the live region mounted while the board is redrawn, so assistive
  // technology can announce moves and completed puzzles reliably.
  const surface = document.createElement('div');
  const live = document.createElement('p');
  live.className = 'tp-puzzle-sr-only';
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  container.replaceChildren(surface, live);

  function reset() {
    tubes = clone(STAGES[stageIndex].tubes);
    selected = null;
    history = [];
    completed = false;
    message = '같은 색의 장식을 한 병에 모아 주세요.';
  }
  function isSolved() {
    return tubes.every(tube => tube.length === 0 || (tube.length === CAPACITY && tube.every(color => color === tube[0])));
  }
  function selectTube(index) {
    if (completed) return;
    const target = tubes[index];
    if (selected === null) {
      if (!target.length) { message = '옮길 장식이 있는 병을 먼저 선택해 주세요.'; return; }
      selected = index;
      message = `${index + 1}번 병 선택. 옮길 병을 선택해 주세요.`;
      return;
    }
    if (selected === index) { selected = null; message = '선택을 취소했어요.'; return; }
    const source = tubes[selected];
    const color = source[source.length - 1];
    if (target.length === CAPACITY || (target.length && target[target.length - 1] !== color)) {
      if (target.length) {
        selected = index;
        message = `${index + 1}번 병을 선택했어요. 빈 병이나 같은 색 위로 옮길 수 있어요.`;
      } else {
        message = '빈 병이나 같은 색 위로 옮길 수 있어요.';
      }
      return;
    }
    history.push(clone(tubes));
    while (source.length && source[source.length - 1] === color && target.length < CAPACITY) target.push(source.pop());
    selected = null;
    message = '잘하고 있어요. 같은 색을 모아 주세요.';
    if (isSolved()) {
      completed = true;
      message = '완성! 모든 색을 제자리에 모았어요.';
      return STAGES[stageIndex].id;
    }
  }
  function render() {
    const stage = STAGES[stageIndex];
    surface.innerHTML = `<section class="tp-puzzle" aria-label="트리 픽 색 정렬 퍼즐">
      <div class="tp-puzzle-heading"><span class="tp-puzzle-eyebrow">TREE PICK · COLOR SORT</span><h2>빛을 모으는 시간</h2><p>장식을 옮겨 같은 색끼리 모아 주세요.</p></div>
      <div class="tp-puzzle-levels" aria-label="도안 선택">${STAGES.map((item, i) => `<button type="button" class="tp-puzzle-level ${i === stageIndex ? 'is-active' : ''}" data-stage="${i}" aria-pressed="${i === stageIndex}">${String(i + 1).padStart(2, '0')} <span>${item.name}</span></button>`).join('')}</div>
      <div class="tp-puzzle-card"><div class="tp-puzzle-card-head"><div><span class="tp-puzzle-small">PATTERN ${String(stageIndex + 1).padStart(2, '0')}</span><h3>${stage.name}</h3><p>${stage.subtitle}</p></div><span class="tp-puzzle-moves"><strong>${history.length}</strong> MOVES</span></div>
      <div class="tp-puzzle-board ${tubes.length > 6 ? 'is-wide' : ''}">${tubes.map((tube, i) => `<button type="button" class="tp-puzzle-tube-button ${selected === i ? 'is-selected' : ''}" data-tube="${i}" aria-pressed="${selected === i}" aria-label="${i + 1}번 병, ${tube.length ? '아래에서부터 ' + tube.map(color => COLORS[color].name).join(', ') : '비어 있음'}${selected === i ? ', 선택됨' : ''}"><span class="tp-puzzle-tube"><span class="tp-puzzle-contents">${tube.map(color => `<span class="tp-puzzle-piece tp-${COLORS[color].className}" aria-hidden="true">${COLORS[color].symbol}</span>`).join('')}</span></span><span class="tp-puzzle-tube-number">${String(i + 1).padStart(2, '0')}</span></button>`).join('')}</div>
      <p class="tp-puzzle-message" aria-hidden="true">${message}</p>
      <div class="tp-puzzle-actions"><button type="button" data-action="undo" ${!history.length || completed ? 'disabled' : ''}>↶ &nbsp;되돌리기</button><button type="button" data-action="restart">↻ &nbsp;다시 하기</button>${completed && stageIndex < STAGES.length - 1 ? '<button type="button" class="tp-puzzle-next" data-action="next">다음 도안 →</button>' : ''}</div></div>
      <p class="tp-puzzle-tip">병을 선택한 뒤 빈 병 또는 같은 색 장식 위로 옮길 수 있어요.</p>
    </section>`;
    live.textContent = message;
  }
  function onClick(event) {
    const button = event.target.closest('button');
    if (!button || !container.contains(button)) return;
    let completedStage;
    if (button.dataset.tube !== undefined) completedStage = selectTube(Number(button.dataset.tube));
    else if (button.dataset.stage !== undefined) { stageIndex = Number(button.dataset.stage); reset(); }
    else if (button.dataset.action === 'restart') reset();
    else if (button.dataset.action === 'next') { stageIndex = Math.min(stageIndex + 1, STAGES.length - 1); reset(); }
    else if (button.dataset.action === 'undo' && history.length && !completed) {
      tubes = history.pop(); selected = null; message = '마지막 이동을 되돌렸어요.';
    } else return;
    render();
    // Keep keyboard users in the puzzle when the board is redrawn.
    const selector = button.dataset.tube !== undefined ? `[data-tube="${button.dataset.tube}"]` : button.dataset.stage !== undefined ? `[data-stage="${button.dataset.stage}"]` : button.dataset.action === 'next' ? `[data-stage="${stageIndex}"]` : `[data-action="${button.dataset.action}"]`;
    if (event.detail === 0) {
      const focusTarget = container.querySelector(selector);
      (focusTarget && !focusTarget.disabled ? focusTarget : container.querySelector('[data-action="restart"]'))?.focus();
    }
    if (completedStage && typeof options.onComplete === 'function') options.onComplete(completedStage, history.length);
  }
  container.addEventListener('click', onClick);
  render();
  return { destroy() { container.removeEventListener('click', onClick); container.replaceChildren(); } };
}
