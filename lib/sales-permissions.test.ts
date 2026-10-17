import test from "node:test";
import assert from "node:assert/strict";
import { canAccessSalesDeal, canChangeSalesDeal } from "./sales-permissions.ts";
import { accessToProject, staffMembershipIn, type MembershipLike } from "./permissions.ts";
const employee = { workspaceId: "skox", clientId: null, role: "staff", email: "seller@example.com" } as const;
const deal = { workspaceId: "skox", ownerEmail: employee.email, stage: "lead", projectId: null };
test("employees can work only their assigned leads in their own workspace", () => {
 assert.equal(canAccessSalesDeal(employee, deal), true);
 assert.equal(canAccessSalesDeal(employee, { ...deal, ownerEmail: "reiss@skoxsoftware.com" }), false);
 assert.equal(canAccessSalesDeal(employee, { ...deal, workspaceId: "other" }), false);
 assert.equal(canAccessSalesDeal({ ...employee, revokedAt: new Date() }, deal), false);
 assert.equal(canAccessSalesDeal({ ...employee, role: "client_member" }, deal), false);
});
test("won and onboarded leads are handed off from employees to admins", () => {
 assert.equal(canChangeSalesDeal(employee, deal), true);
 assert.equal(canChangeSalesDeal(employee, { ...deal, stage: "won" }), false);
 assert.equal(canChangeSalesDeal(employee, { ...deal, projectId: "project" }), false);
 assert.equal(canChangeSalesDeal({ ...employee, role: "staff_owner" }, { ...deal, ownerEmail: "other@example.com", stage: "won" }), true);
});
test("sales membership never grants access to client projects or revoked memberships", () => {
 const project = { workspaceId: "skox", clientId: "client" };
 assert.equal(accessToProject([employee], project), null);
 assert.equal(accessToProject([{ ...employee, role: "staff_owner" }], project)?.isStaff, true);
 const revoked: MembershipLike = { workspaceId: "skox", clientId: "client", role: "client_member", revokedAt: new Date() };
 assert.equal(accessToProject([revoked], project), null);
 assert.equal(staffMembershipIn([{ ...employee, revokedAt: new Date() }]), undefined);
});
