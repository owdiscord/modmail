@external(javascript, "./browser_ffi.mjs", "set_page_title")
pub fn set_page_title(_title: String) -> Nil {
  panic as "target not supported"
}

@external(javascript, "./browser_ffi.mjs", "set_timeout")
pub fn set_timeout(_delay: Int, _callback: fn() -> anything) -> anything {
  panic as "target not supported"
}
