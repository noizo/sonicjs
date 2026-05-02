/**
 * SVG icon constants for social auth CTA buttons.
 *
 * SVG assets sourced from SVG Repo (www.svgrepo.com) via the SVG Repo Mixer Tools.
 * See LICENSE-SVG-ASSETS.md in this directory for full attribution and licence details.
 */

export const GOOGLE_SVG = `<?xml version="1.0" encoding="utf-8"?><!-- Uploaded to: SVG Repo, www.svgrepo.com, Generator: SVG Repo Mixer Tools -->
<svg xmlns="http://www.w3.org/2000/svg"
aria-label="Google" role="img"
viewBox="0 0 512 512"><rect
width="512" height="512"
rx="15%"
fill="#ffffff"/><path fill="#4285f4" d="M386 400c45-42 65-112 53-179H260v74h102c-4 24-18 44-38 57z"/><path fill="#34a853" d="M90 341a192 192 0 0 0 296 59l-62-48c-53 35-141 22-171-60z"/><path fill="#fbbc02" d="M153 292c-8-25-8-48 0-73l-63-49c-23 46-30 111 0 171z"/><path fill="#ea4335" d="M153 219c22-69 116-109 179-50l55-54c-78-75-230-72-297 55z"/></svg>`

export const GITHUB_SVG = `<?xml version="1.0" encoding="utf-8"?><!-- Uploaded to: SVG Repo, www.svgrepo.com, Generator: SVG Repo Mixer Tools -->
<svg xmlns="http://www.w3.org/2000/svg"
aria-label="GitHub" role="img"
viewBox="0 0 512 512"><rect
width="512" height="512"
rx="15%"
fill="#1B1817"/><path fill="#ffffff" d="M335 499c14 0 12 17 12 17H165s-2-17 12-17c13 0 16-6 16-12l-1-50c-71 16-86-28-86-28-12-30-28-37-28-37-24-16 1-16 1-16 26 2 40 26 40 26 22 39 59 28 74 22 2-17 9-28 16-35-57-6-116-28-116-126 0-28 10-51 26-69-3-6-11-32 3-67 0 0 21-7 70 26 42-12 86-12 128 0 49-33 70-26 70-26 14 35 6 61 3 67 16 18 26 41 26 69 0 98-60 120-117 126 10 8 18 24 18 48l-1 70c0 6 3 12 16 12z"/></svg>`

export const FACEBOOK_SVG = `<?xml version="1.0" encoding="utf-8"?><!-- Uploaded to: SVG Repo, www.svgrepo.com, Generator: SVG Repo Mixer Tools -->
<svg xmlns="http://www.w3.org/2000/svg"
aria-label="Facebook" role="img"
viewBox="0 0 512 512"><rect
width="512" height="512"
rx="15%"
fill="#1877f2"/><path d="M355.6 330l11.4-74h-71v-48c0-20.2 9.9-40 41.7-40H370v-63s-29.3-5-57.3-5c-58.5 0-96.7 35.4-96.7 99.6V256h-65v74h65v182h80V330h59.6z" fill="#ffffff"/></svg>`

export const TELEGRAM_SVG = `<?xml version="1.0" encoding="utf-8"?><!-- Uploaded to: SVG Repo, www.svgrepo.com, Generator: SVG Repo Mixer Tools -->
<svg xmlns="http://www.w3.org/2000/svg"
aria-label="Telegram" role="img"
viewBox="0 0 512 512"><rect
width="512" height="512"
rx="15%"
fill="#37aee2"/><path fill="#c8daea" d="M199 404c-11 0-10-4-13-14l-32-105 245-144"/><path fill="#a9c9dd" d="M199 404c7 0 11-4 16-8l45-43-56-34"/><path fill="#f6fbfe" d="M204 319l135 99c14 9 26 4 30-14l55-258c5-22-9-32-24-25L79 245c-21 8-21 21-4 26l83 26 190-121c9-5 17-3 11 4"/></svg>`

export const EMAIL_SVG = `<?xml version="1.0" encoding="utf-8"?><!-- Uploaded to: SVG Repo, www.svgrepo.com, Generator: SVG Repo Mixer Tools -->
<svg xmlns="http://www.w3.org/2000/svg"
aria-label="Email" role="img"
viewBox="0 0 512 512"><rect
width="512" height="512"
rx="15%"
fill="teal"/><rect width="356" height="256" x="78" y="128" fill="#ffffff" rx="8%"/><path fill="none" stroke="teal" stroke-width="20" d="M434 128L269 292c-7 8-19 8-26 0L78 128m0 256l129-128m227 128L305 256"/></svg>`

/**
 * Tailwind classes for a social auth CTA button.
 * Icon-only square buttons. The 5 brand-square SVGs above are designed for
 * this size — 48×48 box with the SVG filling the inner area; rounded corners
 * match the SVG's own rx="15%" treatment for a clean tile look. The CTA row
 * goes in a flex container with horizontal gap, mirroring the layout owners
 * typically use for social sign-in (4 brand tiles in a single line).
 */
export const AUTH_CTA_BUTTON_CLASSES =
  'inline-flex h-12 w-12 items-center justify-center rounded-xl overflow-hidden ring-1 ring-white/10 hover:ring-white/30 transition-all hover:scale-105 focus:outline-none focus:ring-2 focus:ring-white'
