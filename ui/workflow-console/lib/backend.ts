export function backendUrl(path: string): string {
  const base = process.env.CREWAI_BACKEND_URL || "http://127.0.0.1:8000";
  return `${base}${path}`;
}

export async function backendFetch(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(backendUrl(path), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  return response;
}
