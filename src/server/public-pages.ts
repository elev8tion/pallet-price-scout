/**
 * Allowlisted static pages for the combined Scout workspace.
 * Scan lives at `/`. The inventory-routing demo lives at `/routing/`.
 * Unknown paths must not resolve to files — no directory traversal.
 */
export type PublicPage =
  | { kind: "file"; file: string; type: string }
  | { kind: "redirect"; location: string };

export const PUBLIC_FILE_ROUTES: Record<string, { file: string; type: string }> = {
  "/": { file: "web/index.html", type: "text/html" },
  "/robots.txt": { file: "web/robots.txt", type: "text/plain" },
  "/app.js": { file: "web/app.js", type: "application/javascript" },
  "/styles.css": { file: "web/styles.css", type: "text/css" },
  "/demo/pallet-demo.jpg": { file: "web/demo/pallet-demo.jpg", type: "image/jpeg" },
  "/routing/": { file: "web/routing/index.html", type: "text/html" },
  "/routing/index.html": { file: "web/routing/index.html", type: "text/html" },
  "/routing/app.js": { file: "web/routing/app.js", type: "application/javascript" },
  "/routing/demo.js": { file: "web/routing/demo.js", type: "application/javascript" },
  "/routing/styles.css": { file: "web/routing/styles.css", type: "text/css" },
  "/routing/assets/space-grotesk.woff2": { file: "web/routing/assets/space-grotesk.woff2", type: "font/woff2" },
  "/routing/assets/dm-mono.woff2": { file: "web/routing/assets/dm-mono.woff2", type: "font/woff2" },
};

export function resolvePublicPage(pathname: string): PublicPage | null {
  if (pathname === "/routing") return { kind: "redirect", location: "/routing/" };
  const entry = PUBLIC_FILE_ROUTES[pathname];
  if (!entry) return null;
  return { kind: "file", file: entry.file, type: entry.type };
}
