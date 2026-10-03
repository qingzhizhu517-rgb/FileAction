/* 首页项目介绍视频；由用户点击后加载媒体。 */
(() => {
  'use strict';
  const trigger = document.querySelector('#open-project-video');
  const dialog = document.querySelector('#project-video-dialog');
  const video = document.querySelector('#project-video');
  const status = document.querySelector('#project-video-status');
  const retry = document.querySelector('#retry-project-video');
  if (!trigger || !dialog || !video || typeof dialog.showModal !== 'function') return;
  let attempt = 0;

  function clearStatus() {
    status.hidden = true;
    status.textContent = '';
    retry.hidden = true;
  }
  function showError() {
    if (!dialog.open) return;
    status.textContent = '视频暂时无法播放，请重新加载，或在新窗口打开。';
    status.hidden = false;
    retry.hidden = false;
  }
  function play() {
    const current = ++attempt;
    clearStatus();
    video.play().catch(error => {
      if (!dialog.open || current !== attempt || error.name === 'AbortError') return;
      if (error.name === 'NotAllowedError') {
        status.textContent = '请点击视频中的播放按钮开始观看。';
        status.hidden = false;
      } else showError();
    });
  }
  trigger.addEventListener('click', event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    dialog.showModal();
    document.body.classList.add('project-video-open');
    video.src = trigger.getAttribute('href');
    play();
  });
  document.querySelector('#close-project-video').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    attempt++;
    video.pause();
    video.removeAttribute('src');
    video.load();
    clearStatus();
    document.body.classList.remove('project-video-open');
    trigger.focus({ preventScroll: true });
  });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  video.addEventListener('error', showError);
  video.addEventListener('playing', clearStatus);
  retry.addEventListener('click', () => {
    video.load();
    play();
  });
})();
