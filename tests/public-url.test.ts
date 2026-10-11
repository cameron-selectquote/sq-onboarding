import { publicUrl } from "@/lib/public-url";

const req = (url: string, headers: Record<string, string> = {}) => ({ url, headers: new Headers(headers) });

describe("publicUrl", () => {
  it("uses the proxied Host and X-Forwarded-Proto, not the internal req.url", () => {
    const r = req("https://localhost:3000/home", { host: "app.example.com", "x-forwarded-proto": "https" });
    expect(publicUrl("/login?next=%2Fhome", r).toString()).toBe("https://app.example.com/login?next=%2Fhome");
  });

  it("prefers X-Forwarded-Host and takes the first value of a list", () => {
    const r = req("http://localhost:3000/", {
      host: "127.0.0.1:3000",
      "x-forwarded-host": "app.example.com, inner.proxy",
      "x-forwarded-proto": "https, http",
    });
    expect(publicUrl("/home", r).origin).toBe("https://app.example.com");
  });

  it("falls back to req.url when no proxy headers are present", () => {
    expect(publicUrl("/login", req("http://localhost:3000/x")).toString()).toBe("http://localhost:3000/login");
  });

  it("only allows http or https", () => {
    const r = req("http://localhost:3000/", { host: "app.example.com", "x-forwarded-proto": "javascript" });
    expect(publicUrl("/home", r).protocol).toBe("http:");
  });
});
