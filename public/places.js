const CONTENT = {
  square: {
    number: '01', english: 'THE TREE SQUARE', title: '트리 광장', subtitle: '마음이 모여 빛나는 곳',
    description: '편지에 담긴 마음이 얼마나 모였는지 이곳에서 함께 볼 수 있어요.',
    illustration: `<div class="place-art place-art--square" aria-hidden="true"><div class="place-stars">✦ <span>✧</span> ✦</div><img src="/assets/village/snow-tree-gouache.png" alt=""><div class="place-snowbank"></div><div class="place-glow"></div></div>`,
    actions: `<div class="place-tree-count" role="status" aria-live="polite"><span class="place-tree-count__label">공동 트리에 모인 마음</span><strong data-count>불러오는 중…</strong><button class="place-retry" type="button" data-action="retry" hidden>다시 불러오기</button></div><button class="place-action place-action--primary" type="button" data-action="write"><span>✉</span> 편지로 마음 전하기 <b>↗</b></button>`,
  },
  post: {
    number: '02', english: 'THE POST OFFICE', title: '마을 우체국', subtitle: '당신의 마음이 머무는 곳',
    description: '소중한 사람에게 전하고 싶은 이야기를 편지에 담아보세요.',
    illustration: `<div class="place-art place-art--post" aria-hidden="true"><div class="place-window"><span>✦</span><i></i></div><div class="place-post-light"></div><div class="place-shelf"><span>✉</span><span>✉</span><span>✉</span></div><div class="place-desk"><div class="place-envelope"><span>♥</span></div><div class="place-ink">✒</div></div></div>`,
    actions: `<button class="place-action place-action--primary" type="button" data-action="write"><span>✉</span> 편지 쓰기 <b>↗</b></button><button class="place-action place-action--secondary" type="button" data-action="read"><span>▤</span> 내가 보낸 편지 <b>→</b></button><p class="place-note">편지는 가입이나 게임 없이 열고 답장할 수 있어요.</p>`,
  },
  game: {
    number: '03', english: 'THE GAME ROOM', title: '반짝이는 게임장', subtitle: '천천히 즐기는 작은 놀이',
    description: '마음에 드는 게임을 고르고 크리스마스의 반짝임을 모아보세요.',
    illustration: `<div class="place-art place-art--game" aria-hidden="true"><div class="place-game-stars">✦ <span>✧</span> ✦</div><div class="place-game-shelf"></div><div class="place-bottles"><div><i></i><i></i><i></i></div><div><i></i><i></i><i></i></div><div><i></i><i></i><i></i></div></div><div class="place-game-caption">A LITTLE PLAY TIME</div></div>`,
    actions: `<a class="place-action place-action--primary" href="https://treepick.vercel.app/play/difficulty" target="_blank" rel="noopener noreferrer"><span>✦</span> 기존 TREE PICK 게임 <b>새 창 ↗</b></a><button class="place-action place-action--secondary" type="button" data-action="game"><span>◒</span> 마을 시험 퍼즐 <b>→</b></button><p class="place-note">기존 게임은 별도 창에서 열려요. 마을 시험 퍼즐에서는 보상이 지급되지 않아요.</p>`,
  },
};

/** Mount a destination view; navigation remains with the host application. */
export function mountPlace(container, { placeId, onBack, onWrite, onRead, onGame } = {}) {
  if (!(container instanceof HTMLElement)) throw new TypeError('A place container is required.');
  const place = CONTENT[placeId];
  if (!place) throw new RangeError('Unknown place.');
  const lifecycle = new AbortController();
  container.innerHTML = `<main class="shell place-screen place-screen--${placeId}">
    <header class="place-header"><button class="place-back" type="button" data-action="back" aria-label="마을로 돌아가기">← <span>마을로</span></button><span class="place-header__label">TREE PICK <span>·</span> ${place.english}</span><span class="place-header__star" aria-hidden="true">✦</span></header>
    ${place.illustration}
    <section class="place-content" aria-labelledby="place-title"><div class="place-kicker">${place.number} / ${place.english}</div><h1 id="place-title" tabindex="-1">${place.title}</h1><p class="place-subtitle">${place.subtitle}</p><p class="place-description">${place.description}</p><div class="place-actions">${place.actions}</div><button class="place-leave" type="button" data-action="back">← 마을로 돌아가기</button></section>
  </main>`;
  const root = container.querySelector('.place-screen');
  const handlers = { back: onBack, write: onWrite, read: onRead, game: onGame };
  let disposed = false;
  let countRequest = null;
  async function loadCount() {
    const value = root.querySelector('[data-count]');
    const retry = root.querySelector('[data-action="retry"]');
    if (!value || !retry) return;
    countRequest?.abort();
    countRequest = new AbortController();
    value.textContent = '불러오는 중…'; retry.hidden = true;
    try {
      const response = await fetch('/api/v1/community-tree', { cache: 'no-store', signal: countRequest.signal });
      if (!response.ok) throw new Error('unavailable');
      const payload = await response.json();
      if (!Number.isSafeInteger(payload?.data?.letterCount) || payload.data.letterCount < 0) throw new Error('invalid');
      if (!disposed) value.textContent = `${payload.data.letterCount.toLocaleString('ko-KR')}통`;
    } catch (error) {
      if (error.name === 'AbortError' || disposed) return;
      value.textContent = '잠시 불러올 수 없어요'; retry.hidden = false;
    }
  }
  root.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button || !root.contains(button)) return;
    const action = button.dataset.action;
    if (action === 'retry') { loadCount(); return; }
    if (typeof handlers[action] === 'function') handlers[action]();
  }, { signal: lifecycle.signal });
  if (placeId === 'square') loadCount();
  // Focus the new heading so keyboard and screen-reader users know the destination changed.
  const heading = root.querySelector('#place-title');
  requestAnimationFrame(() => { if (!disposed && heading?.isConnected) heading.focus({ preventScroll: true }); });
  return { dispose() { if (disposed) return; disposed = true; countRequest?.abort(); lifecycle.abort(); } };
}
