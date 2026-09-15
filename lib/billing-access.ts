import type { ProjectAccess } from "./permissions";

export function isStripeSandbox(key: string | undefined) {
  return /^(sk|rk)_test_/.test(key ?? "");
}

/** Staff can exercise Checkout with test keys; clients need payment authority. */
export function canCheckout(access: ProjectAccess, sandbox: boolean) {
  return access.isStaff ? sandbox : access.clientRole === "client_approver";
}
