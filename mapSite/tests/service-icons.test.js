import assert from "node:assert/strict";
import { test } from "node:test";
import { SERVICE_ICONS, serviceIconKey, serviceIconSvg } from "../service-icons.js";

test("every reporting category has a distinct local service icon", () => {
  const categories = { healthcare: "hospital", transportation: "transit", water: "water", broadband: "broadband", food: "food", emergency_response: "emergency", other: "other" };
  for (const [category, key] of Object.entries(categories)) {
    assert.equal(serviceIconKey(category), key);
    assert.match(serviceIconSvg(category), /^<svg/);
    assert.equal(serviceIconSvg(category), SERVICE_ICONS[key]);
  }
  assert.equal(new Set(Object.values(SERVICE_ICONS)).size, 11);
});

test("inferred service names select the appropriate specific icon", () => {
  const services = { "Community health clinic": "hospital", Pharmacy: "medication", "Meditation support": "hospital", "Gas station": "fuel", "Transit stop or shuttle hub": "transit", "Community water station": "water", "Public internet access point": "broadband", "Food distribution point": "food", "Emergency response station": "emergency", "Community service center": "other", "Local school": "education", "Road repairs": "roads" };
  for (const [service, key] of Object.entries(services)) {
    assert.equal(serviceIconKey("other", service), key, service);
  }
});

test("icons fall back safely and never interpolate report content into SVG markup", () => {
  for (const category of [null, undefined, {}, "constructor", "toString", "<img src=x onerror=alert(1)>"]) {
    assert.equal(serviceIconSvg(category), SERVICE_ICONS.other);
  }
  assert.equal(serviceIconSvg("healthcare", '<script>alert("x")</script>'), SERVICE_ICONS.hospital);
  for (const svg of Object.values(SERVICE_ICONS)) {
    assert.match(svg, /aria-hidden="true"/);
    assert.doesNotMatch(svg, /<script|<image|href=|onload=|https:\/\//);
  }
});
