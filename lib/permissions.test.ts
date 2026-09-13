import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accessToProject,
  can,
  canInviteRole,
  canSign,
  normalizeEmail,
  staffMembershipIn,
  type MembershipLike,
} from "./permissions.ts";

const WS = "ws-skox";
const OTHER_WS = "ws-other";
const CLIENT = "client-acme";
const OTHER_CLIENT = "client-globex";
const project = { workspaceId: WS, clientId: CLIENT };

const staff: MembershipLike = { workspaceId: WS, clientId: null, role: "staff" };
const approver: MembershipLike = { workspaceId: WS, clientId: CLIENT, role: "client_approver" };
const member: MembershipLike = { workspaceId: WS, clientId: CLIENT, role: "client_member" };

test("staff can see and manage any project in their workspace", () => {
  const a = accessToProject([staff], project);
  assert.deepEqual(a, { isStaff: true, clientRole: null });
  assert.equal(can.manageProject(a!), true);
  assert.equal(can.approve(a!), false, "SKOX requests approvals, it never gives them");
});

test("staff of another workspace get nothing", () => {
  assert.equal(accessToProject([{ ...staff, workspaceId: OTHER_WS }], project), null);
});

test("a client approver can view, give feedback, approve and invite", () => {
  const a = accessToProject([approver], project)!;
  assert.equal(can.viewProject(a), true);
  assert.equal(can.leaveFeedback(a), true);
  assert.equal(can.approve(a), true);
  assert.equal(can.inviteTeammates(a), true);
  assert.equal(can.manageProject(a), false);
});

test("a client member can view and give feedback only", () => {
  const a = accessToProject([member], project)!;
  assert.equal(can.viewProject(a), true);
  assert.equal(can.leaveFeedback(a), true);
  assert.equal(can.approve(a), false);
  assert.equal(can.inviteTeammates(a), false);
  assert.equal(can.manageProject(a), false);
});

test("a client cannot see another client's project", () => {
  assert.equal(accessToProject([{ ...approver, clientId: OTHER_CLIENT }], project), null);
});

test("no memberships means no access", () => {
  assert.equal(accessToProject([], project), null);
});

test("a staff role on a client row does not make someone staff", () => {
  const smuggled: MembershipLike = { workspaceId: WS, clientId: CLIENT, role: "staff_owner" };
  assert.equal(staffMembershipIn([smuggled], WS), undefined);
  assert.equal(accessToProject([smuggled], project), null);
});

test("invitations can never grant staff roles", () => {
  const a = accessToProject([approver], project)!;
  assert.equal(canInviteRole(a, "client_member"), true);
  assert.equal(canInviteRole(a, "staff"), false);
  assert.equal(canInviteRole(accessToProject([member], project)!, "client_member"), false);
});

test("only the named signer can sign, once, while the document is out", () => {
  const doc = { status: "out_for_signature" as const };
  const signer = { email: "ceo@acme.com", status: "pending" as const };
  assert.equal(canSign("CEO@acme.com", doc, signer), true);
  assert.equal(canSign("cfo@acme.com", doc, signer), false, "someone else can't sign for them");
  assert.equal(canSign("ceo@acme.com", doc, { ...signer, status: "signed" }), false, "no double signing");
  assert.equal(canSign("ceo@acme.com", { status: "void" }, signer), false);
  assert.equal(canSign("ceo@acme.com", doc, undefined), false, "not a signer at all");
});

test("clients raise requests and react to ideas; staff run billing and share links", () => {
  const s = accessToProject([staff], project)!;
  const ap = accessToProject([approver], project)!;
  const m = accessToProject([member], project)!;
  assert.equal(can.requestSupport(m), true);
  assert.equal(can.requestSupport(s), false, "SKOX doesn't file requests to itself");
  assert.equal(can.createShareLink(ap), true);
  assert.equal(can.createShareLink(m), false);
  assert.equal(can.uploadFiles(m), true);
});

test("emails are compared case- and space-insensitively", () => {
  assert.equal(normalizeEmail("  Founders@SKOXsoftware.com "), "founders@skoxsoftware.com");
});
