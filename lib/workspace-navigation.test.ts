import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeNavigation, workspaceLocation } from './workspace-navigation.ts';

test('navigation matches route boundaries without activating overview on every admin page', () => {
  assert.equal(activeNavigation('/admin', '/admin/projects'), false);
  assert.equal(activeNavigation('/admin/projects', '/admin/projects/123/brief'), true);
  assert.equal(activeNavigation('/admin/projects', '/admin/projects-archive'), false);
});
test('back links work on direct entry into admin and client pages', () => {
  assert.equal(workspaceLocation('/admin', true).back, null);
  assert.equal(workspaceLocation('/admin/projects/123/brief', true).back?.href, '/admin/projects/123');
  assert.equal(workspaceLocation('/admin/clients/123', true).back?.href, '/admin/clients');
  assert.equal(workspaceLocation('/projects/123/documents/456', false).back?.href, '/projects/123/documents');
  assert.equal(workspaceLocation('/projects/123/files', false).back?.href, '/projects/123');
  assert.equal(workspaceLocation('/projects/123', false).back?.href, '/');
  assert.equal(workspaceLocation('/settings', false).back?.href, '/');
});
