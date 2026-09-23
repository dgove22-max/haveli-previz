#!/bin/sh
# Local dev server — fetch() needs HTTP, file:// will not load the JSON.
#
# Serves with caching switched OFF. python3 -m http.server sends no cache
# headers at all, which lets browsers hold on to ES modules indefinitely — you
# edit a file, reload, and still get the old code, with no hint that is what
# happened. Every request here is no-store, so a plain reload is always enough.
echo "Haveli Previz → http://localhost:5173  (caching disabled)"
exec python3 - "$@" <<'PY'
import http.server, socketserver

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('', 5173), NoCache) as srv:
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
PY
