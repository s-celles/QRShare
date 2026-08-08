import { describe, expect, test } from "bun:test";
import {
  buildWifiString,
  parseWifiString,
  buildMecardString,
  buildVCardString,
  parseContactString,
  parseStructuredQR,
} from "@/qr/structured";

describe("Wi-Fi QR Encoder & Parser", () => {
  test("builds standard WPA Wi-Fi string", () => {
    const res = buildWifiString({
      ssid: "MyHomeWifi",
      security: "WPA",
      password: "secretpassword123",
    });
    expect(res).toBe("WIFI:S:MyHomeWifi;T:WPA;P:secretpassword123;;");
  });

  test("builds nopass Wi-Fi string without password field", () => {
    const res = buildWifiString({
      ssid: "FreeWifi",
      security: "nopass",
    });
    expect(res).toBe("WIFI:S:FreeWifi;T:nopass;;");
  });

  test("builds hidden network Wi-Fi string", () => {
    const res = buildWifiString({
      ssid: "HiddenNet",
      security: "WPA",
      password: "pass",
      hidden: true,
    });
    expect(res).toBe("WIFI:S:HiddenNet;T:WPA;P:pass;H:true;;");
  });

  test("escapes special characters in SSID and Password", () => {
    const res = buildWifiString({
      ssid: "Wifi;with:special,chars\\and\"quotes",
      security: "WPA",
      password: "pass;word:123",
    });
    expect(res).toBe(
      "WIFI:S:Wifi\\;with\\:special\\,chars\\\\and\\\"quotes;T:WPA;P:pass\\;word\\:123;;",
    );
  });

  test("parses valid Wi-Fi string", () => {
    const raw = "WIFI:S:OfficeWifi;T:WPA;P:OfficePass123;;";
    const parsed = parseWifiString(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.kind).toBe("wifi");
    if (parsed?.kind === "wifi") {
      expect(parsed.ssid).toBe("OfficeWifi");
      expect(parsed.security).toBe("WPA");
      expect(parsed.password).toBe("OfficePass123");
      expect(parsed.hidden).toBe(false);
    }
  });

  test("parses Wi-Fi string with escaped characters", () => {
    const raw = "WIFI:S:My\\;Network;T:WPA;P:p\\:a\\;ss;;";
    const parsed = parseWifiString(raw);
    expect(parsed).not.toBeNull();
    if (parsed?.kind === "wifi") {
      expect(parsed.ssid).toBe("My;Network");
      expect(parsed.password).toBe("p:a;ss");
    }
  });
});

describe("MECARD and vCard Contact Encoder & Parser", () => {
  test("builds MECARD string", () => {
    const res = buildMecardString({
      firstName: "Jean",
      lastName: "Dupont",
      phone: "+33601020304",
      email: "jean.dupont@example.com",
      org: "Acme Corp",
      url: "https://example.com",
      note: "Key contact",
    });
    expect(res).toBe(
      "MECARD:N:Dupont,Jean;TEL:+33601020304;EMAIL:jean.dupont@example.com;ORG:Acme Corp;URL:https\\://example.com;NOTE:Key contact;;",
    );
  });

  test("builds vCard 3.0 string", () => {
    const res = buildVCardString({
      firstName: "Alice",
      lastName: "Smith",
      phone: "123456",
      email: "alice@example.com",
    });
    expect(res).toContain("BEGIN:VCARD");
    expect(res).toContain("VERSION:3.0");
    expect(res).toContain("N:Smith;Alice;;;");
    expect(res).toContain("FN:Alice Smith");
    expect(res).toContain("TEL:123456");
    expect(res).toContain("EMAIL:alice@example.com");
    expect(res).toContain("END:VCARD");
  });

  test("parses MECARD string", () => {
    const raw = "MECARD:N:Martin,Paul;TEL:0102030405;EMAIL:paul@test.com;ORG:TestOrg;;";
    const parsed = parseContactString(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.kind).toBe("contact");
    if (parsed?.kind === "contact") {
      expect(parsed.format).toBe("mecard");
      expect(parsed.firstName).toBe("Paul");
      expect(parsed.lastName).toBe("Martin");
      expect(parsed.fullName).toBe("Paul Martin");
      expect(parsed.phone).toBe("0102030405");
      expect(parsed.email).toBe("paul@test.com");
      expect(parsed.org).toBe("TestOrg");
    }
  });

  test("parses vCard string", () => {
    const raw = `BEGIN:VCARD
VERSION:3.0
N:Doe;John;;;
FN:John Doe
TEL:987654321
EMAIL:john@doe.com
URL:https://john.com
END:VCARD`;

    const parsed = parseContactString(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.kind).toBe("contact");
    if (parsed?.kind === "contact") {
      expect(parsed.format).toBe("vcard");
      expect(parsed.firstName).toBe("John");
      expect(parsed.lastName).toBe("Doe");
      expect(parsed.fullName).toBe("John Doe");
      expect(parsed.phone).toBe("987654321");
      expect(parsed.email).toBe("john@doe.com");
      expect(parsed.url).toBe("https://john.com");
    }
  });
});

describe("parseStructuredQR Main Dispatcher", () => {
  test("categorizes Wi-Fi QR", () => {
    const res = parseStructuredQR("WIFI:S:Guest;T:WPA;P:12345678;;");
    expect(res.kind).toBe("wifi");
  });

  test("categorizes Contact MECARD QR", () => {
    const res = parseStructuredQR("MECARD:N:Doe,Jane;TEL:111;;");
    expect(res.kind).toBe("contact");
  });

  test("categorizes URL QR", () => {
    const res = parseStructuredQR("https://github.com/s-celles/QRShare");
    expect(res.kind).toBe("url");
  });

  test("categorizes Plain Text QR", () => {
    const res = parseStructuredQR("Hello World! Just a plain message.");
    expect(res.kind).toBe("text");
  });
});
