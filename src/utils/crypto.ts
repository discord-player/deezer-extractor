let rawCrypto: typeof import("crypto");

export async function getCrypto() {
  if (!rawCrypto) {
    rawCrypto = await import("crypto");
    return rawCrypto;
  }

  return rawCrypto;
}
