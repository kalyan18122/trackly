// Tiny static file server for the front end (no packages needed).
const http = require("http");
const fs = require("fs");
const path = require("path");
const PORT = process.env.PORT || 5500;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

http.createServer((req, res) => {
  const url = req.url.split("?")[0];
  const file = path.join(__dirname, url === "/" ? "index.html" : path.normalize(url));
  if (!file.startsWith(__dirname)) { res.writeHead(403); return res.end("Forbidden"); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
}).listen(PORT, () => console.log("Trackly front end running at http://localhost:" + PORT));
