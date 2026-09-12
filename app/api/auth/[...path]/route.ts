import { getAuth } from "@/lib/auth/server";

type Handlers = ReturnType<ReturnType<typeof getAuth>["handler"]>;

export function GET(...args: Parameters<Handlers["GET"]>) {
  return getAuth().handler().GET(...args);
}

export function POST(...args: Parameters<Handlers["POST"]>) {
  return getAuth().handler().POST(...args);
}
