// Test-only module hooks so server actions can be called under plain Node:
//  - "@/auth"        → an auth() that returns whatever session the test sets on globalThis.__testSession
//  - "next/cache"    → no-op revalidatePath / revalidateTag
// Everything else (permissions, session resolution, services, database) is the real code.
import { registerHooks } from "node:module";

const stub = (name) => new URL(`./${name}`, import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/auth") return { url: stub("auth-stub.mjs"), shortCircuit: true };
    if (specifier === "next/cache") return { url: stub("next-cache-stub.mjs"), shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
