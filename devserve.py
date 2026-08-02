#!/usr/bin/env python3
"""Static file server for local use: no caching, so an edit is one refresh away."""
import sys, http.server, socketserver

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8123

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, max-age=0')
        super().end_headers()
    def log_message(self, *a):
        pass

with socketserver.TCPServer(('127.0.0.1', PORT), Handler) as httpd:
    print('HelloID Analytics  ->  http://localhost:%d' % PORT)
    httpd.serve_forever()
