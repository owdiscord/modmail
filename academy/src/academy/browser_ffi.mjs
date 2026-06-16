export function set_page_title(title) {
  document.title = title;
}

export function set_timeout(delay, fn) {
  setTimeout(fn, delay);
}

export function set_timeout_async(delay, fn) {
  setTimeout(async () => fn, delay);
}
