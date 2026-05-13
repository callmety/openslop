# Security

**This project is unmaintained.**

No one is monitoring this repo for security reports, and no response,
acknowledgment, patch, or advisory should be expected. Please do not
file public issues, private advisories, or email about vulnerabilities
in this codebase — they will not be answered.

If you've found something serious, the useful path is:

- **Fork the repo and fix it in your fork.** The
  [PolyForm Noncommercial 1.0.0](./LICENSE) license permits this for
  any noncommercial use.
- **Publicly document the issue** so other forks and users know to
  apply a similar fix. Coordinated disclosure is moot here because
  there is nobody to coordinate with.
- **Stop using this build** in the meantime.

The codebase makes no network calls, has no runtime dependencies, and
asks for `storage` plus one host pattern — so the practical blast
radius of any issue is bounded by the host scope and the DOM-injection
surface inside the extension itself. That's a useful starting point
for your own review.
