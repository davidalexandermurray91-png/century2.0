# vendor/

`three.module.min.js` and its sibling `three.core.min.js` are three.js r180,
copied verbatim from the npm package. They are committed rather than pulled
from a CDN so that world mode works offline, on a locked-down network, and
inside a sandboxed frame with a strict content policy.

three.js is MIT licensed — see `THREE-LICENSE`.

To update: `npm i three@<version>` then copy both build files across, and bump
the version in the import map in `index.html`.
