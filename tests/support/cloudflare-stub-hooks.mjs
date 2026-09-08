export async function resolve(specifier, context, next) {
  if (specifier.startsWith("cloudflare:")) {
    return { url: `cfstub:${specifier}`, shortCircuit: true };
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.startsWith("cfstub:")) {
    return {
      format: "module",
      shortCircuit: true,
      source: "export const env = {};\nexport default {};\n",
    };
  }
  return next(url, context);
}
