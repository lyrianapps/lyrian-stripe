/**
 * Test request helpers for Next.js API route testing
 */
import { NextRequest } from "next/server";

/**
 * Creates a NextRequest for testing API routes
 */
export function createTestRequest(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): NextRequest {
  const { method = "GET", headers = {}, body } = options;

  return new NextRequest(url, {
    method,
    headers: new Headers(headers),
    body,
  });
}

/**
 * Creates a GET request with query params
 */
export function createGetRequest(
  baseUrl: string,
  params: Record<string, string>,
  headers: Record<string, string> = {},
): NextRequest {
  const url = new URL(baseUrl);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  return createTestRequest(url.toString(), { method: "GET", headers });
}

/**
 * Creates a POST request with JSON body
 */
export function createPostRequest(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): NextRequest {
  return createTestRequest(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
