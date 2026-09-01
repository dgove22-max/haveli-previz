#!/bin/sh
# Local dev server — fetch() needs HTTP, file:// will not load the JSON.
echo "Haveli Previz → http://localhost:5173"
exec python3 -m http.server 5173
