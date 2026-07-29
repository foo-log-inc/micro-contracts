/**
 * Screen Spec Tests
 * 
 * Tests for screen specification support:
 * - ScreenContext extraction from OpenAPI (legacy x-events & new inline x-event)
 * - Screen lint rules
 * - Screen template rendering
 * - Inline x-event: string, object, $ref forms
 * - x-interactions support
 * - params auto-derivation
 */

import { describe, it, expect } from 'vitest';
import Handlebars from 'handlebars';
import { buildTemplateContext } from '../src/generator/templateProcessor.js';
import { lintSpec } from '../src/generator/linter.js';
import { resolveModuleConfig } from '../src/types.js';
import type { OpenAPISpec } from '../src/types.js';

// Import template processor to register Handlebars helpers
import '../src/generator/templateProcessor.js';

// =====================================================================
// Test fixtures
// =====================================================================

/** Legacy screen spec using x-events (v0.13 style) */
function createLegacyScreenSpec(): OpenAPISpec {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Test Screen Specification',
      version: '1.0.0',
      description: 'Screen contracts for testing',
    },
    servers: [{ url: '/', description: 'Client-side routes' }],
    paths: {
      '/home': {
        get: {
          operationId: 'renderHomePage',
          summary: 'Render home page',
          security: [{ session: [] }],
          'x-screen-const': 'HOME',
          'x-screen-id': 'SCR-001',
          'x-screen-name': 'HomePage',
          'x-back-navigation': false,
          'x-events': [
            { name: 'home_view', type: 'screen_view', method: 'trackView' },
            { name: 'sign_out', type: 'user_action', method: 'trackSignOut' },
            { name: 'item_tap', type: 'user_action', method: 'trackItemTap', params: { item_id: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Home page ViewModel',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/HomePageViewModel' },
                },
              },
              links: {
                goToSettings: {
                  operationId: 'renderSettingsPage',
                  description: 'Navigate to settings',
                },
                goToChat: {
                  operationId: 'renderChatPage',
                  description: 'Navigate to chat',
                },
              },
            },
          },
        },
      },
      '/settings': {
        get: {
          operationId: 'renderSettingsPage',
          summary: 'Render settings page',
          security: [{ session: [] }],
          'x-screen-const': 'SETTINGS',
          'x-screen-id': 'SCR-002',
          'x-screen-name': 'SettingsPage',
          'x-back-navigation': true,
          'x-events': [
            { name: 'settings_view', type: 'screen_view', method: 'trackView' },
          ],
          responses: {
            '200': {
              description: 'Settings page ViewModel',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/SettingsPageViewModel' },
                },
              },
              links: {
                goToHome: {
                  operationId: 'renderHomePage',
                },
              },
            },
          },
        },
      },
      '/chat': {
        get: {
          operationId: 'renderChatPage',
          summary: 'Render chat page',
          security: [{ session: [] }],
          'x-screen-const': 'CHAT',
          'x-screen-id': 'SCR-003',
          'x-screen-name': 'ChatPage',
          'x-back-navigation': true,
          responses: {
            '200': {
              description: 'Chat page ViewModel',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ChatPageViewModel' },
                },
              },
            },
          },
        },
      },
      '/start': {
        get: {
          operationId: 'renderStartPage',
          summary: 'Render start page',
          security: [],
          'x-screen-const': 'START',
          'x-screen-id': 'SCR-004',
          'x-screen-name': 'StartPage',
          'x-back-navigation': false,
          responses: {
            '200': {
              description: 'Start page ViewModel',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/StartPageViewModel' },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        HomePageViewModel: {
          type: 'object',
          required: ['greeting'],
          properties: { greeting: { type: 'string' } },
        },
        SettingsPageViewModel: {
          type: 'object',
          required: ['theme'],
          properties: { theme: { type: 'string' } },
        },
        ChatPageViewModel: {
          type: 'object',
          required: ['messages'],
          properties: { messages: { type: 'array', items: { type: 'string' } } },
        },
        StartPageViewModel: {
          type: 'object',
          required: ['features'],
          properties: { features: { type: 'array', items: { type: 'string' } } },
        },
      },
    },
  };
}

/** New inline x-event spec (v0.14 style) with all features */
function createInlineEventSpec(): OpenAPISpec {
  return {
    openapi: '3.1.0',
    info: { title: 'Inline Event Test', version: '1.0.0' },
    servers: [{ url: '/' }],
    paths: {
      '/calendar/{yearMonth}': {
        get: {
          operationId: 'renderCalendarPage',
          summary: 'Calendar page',
          security: [{ session: [] }],
          'x-screen-const': 'CALENDAR',
          'x-screen-id': 'SCR-010',
          'x-screen-name': 'CalendarPage',
          'x-back-navigation': true,
          'x-event': 'calendar_view',
          'x-interactions': [
            {
              name: 'daySwipe',
              description: 'Horizontal day-by-day swipe navigation',
              'x-event': {
                name: 'day_swipe',
                params: { direction: 'string' },
              },
            },
            {
              name: 'itemSelect',
              description: 'Select an item from choices',
              'x-event': {
                name: 'item_select',
                params: { itemId: 'string' },
              },
              module: '@ui/selector',
            },
          ] as unknown as any[],
          responses: {
            '200': {
              description: 'Calendar ViewModel',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/CalendarViewModel' },
                },
              },
              links: {
                goToDetail: {
                  operationId: 'renderDetailPage',
                  'x-event': { $ref: '#/components/x-event-defs/itemTap' },
                },
              },
            },
          },
        } as any,
        post: {
          operationId: 'actionCalendarPage',
          summary: 'Calendar action',
          'x-event': 'mode_switch',
          responses: { '200': { description: 'OK' } },
        } as any,
        delete: {
          operationId: 'deleteCalendarItem',
          summary: 'Delete calendar item',
          'x-event': { name: 'item_delete', params: { itemId: 'string' } },
          responses: { '200': { description: 'OK' } },
        } as any,
      },
      '/detail/{itemId}': {
        get: {
          operationId: 'renderDetailPage',
          summary: 'Detail page',
          'x-screen-const': 'DETAIL',
          'x-screen-id': 'SCR-011',
          'x-screen-name': 'DetailPage',
          'x-back-navigation': true,
          'x-event': {
            name: 'detail_view',
            type: 'screen_view',
          },
          responses: {
            '200': {
              description: 'Detail ViewModel',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/DetailViewModel' },
                },
              },
            },
          },
        } as any,
      },
      '/oauth/callback': {
        get: {
          operationId: 'renderOAuthCallback',
          summary: 'OAuth callback',
          'x-screen-const': 'OAUTH_CALLBACK',
          'x-screen-id': 'SCR-012',
          'x-screen-name': 'OAuthCallbackPage',
          'x-event': {
            name: 'oauth_callback_result',
            type: 'system',
            params: { success: 'boolean' },
          },
          responses: {
            '200': {
              description: 'Callback result',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/OAuthResultViewModel' },
                },
              },
            },
          },
        } as any,
      },
      '/simple': {
        get: {
          operationId: 'renderSimplePage',
          summary: 'Simple page with no events',
          'x-screen-const': 'SIMPLE',
          'x-screen-id': 'SCR-013',
          'x-screen-name': 'SimplePage',
          responses: {
            '200': {
              description: 'Simple ViewModel',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/SimpleViewModel' },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        CalendarViewModel: { type: 'object', properties: {} },
        DetailViewModel: { type: 'object', properties: {} },
        OAuthResultViewModel: { type: 'object', properties: {} },
        SimpleViewModel: { type: 'object', properties: {} },
      },
      'x-event-defs': {
        itemTap: {
          name: 'item_tap',
          params: { itemId: 'string' },
        },
      },
    } as any,
  };
}

// =====================================================================
// Legacy tests (backward compatibility with x-events)
// =====================================================================

describe('Screen Spec - Legacy ScreenContext extraction', () => {
  it('extracts screens from spec when screen mode is enabled', () => {
    const spec = createLegacyScreenSpec();
    const ctx = buildTemplateContext(spec, 'testScreens', { screen: true });

    expect(ctx.screens).toHaveLength(4);
  });

  it('returns empty screens when screen mode is disabled', () => {
    const spec = createLegacyScreenSpec();
    const ctx = buildTemplateContext(spec, 'testScreens', { screen: false });

    expect(ctx.screens).toHaveLength(0);
  });

  it('extracts correct screen properties', () => {
    const spec = createLegacyScreenSpec();
    const ctx = buildTemplateContext(spec, 'testScreens', { screen: true });

    const home = ctx.screens.find(s => s.screenConst === 'HOME')!;
    expect(home).toBeDefined();
    expect(home.route).toBe('/home');
    expect(home.screenId).toBe('SCR-001');
    expect(home.screenName).toBe('HomePage');
    expect(home.operationId).toBe('renderHomePage');
    expect(home.supportsBack).toBe(false);
    expect(home.viewModelSchema).toBe('HomePageViewModel');
    expect(home.requiresAuth).toBe(true);
  });

  it('extracts navigation links from response', () => {
    const spec = createLegacyScreenSpec();
    const ctx = buildTemplateContext(spec, 'testScreens', { screen: true });

    const home = ctx.screens.find(s => s.screenConst === 'HOME')!;
    expect(home.links).toHaveLength(2);
    expect(home.links[0]).toMatchObject({
      name: 'goToSettings',
      targetRoute: '/settings',
      targetOperationId: 'renderSettingsPage',
    });
    expect(home.links[1]).toMatchObject({
      name: 'goToChat',
      targetRoute: '/chat',
      targetOperationId: 'renderChatPage',
    });
  });

  it('extracts events with params', () => {
    const spec = createLegacyScreenSpec();
    const ctx = buildTemplateContext(spec, 'testScreens', { screen: true });

    const home = ctx.screens.find(s => s.screenConst === 'HOME')!;
    expect(home.events).toHaveLength(3);
    expect(home.events[0]).toEqual({
      name: 'home_view',
      type: 'screen_view',
      method: 'trackView',
    });
    expect(home.events[2]).toEqual({
      name: 'item_tap',
      type: 'user_action',
      method: 'trackItemTap',
      params: { item_id: 'string' },
    });
  });

  it('handles back navigation correctly', () => {
    const spec = createLegacyScreenSpec();
    const ctx = buildTemplateContext(spec, 'testScreens', { screen: true });

    const home = ctx.screens.find(s => s.screenConst === 'HOME')!;
    const settings = ctx.screens.find(s => s.screenConst === 'SETTINGS')!;
    expect(home.supportsBack).toBe(false);
    expect(settings.supportsBack).toBe(true);
  });

  it('detects auth requirement from security field', () => {
    const spec = createLegacyScreenSpec();
    const ctx = buildTemplateContext(spec, 'testScreens', { screen: true });

    const home = ctx.screens.find(s => s.screenConst === 'HOME')!;
    const start = ctx.screens.find(s => s.screenConst === 'START')!;
    expect(home.requiresAuth).toBe(true);
    expect(start.requiresAuth).toBe(false);
  });

  it('handles screens with no links', () => {
    const spec = createLegacyScreenSpec();
    const ctx = buildTemplateContext(spec, 'testScreens', { screen: true });

    const chat = ctx.screens.find(s => s.screenConst === 'CHAT')!;
    expect(chat.links).toHaveLength(0);
  });

  it('handles screens with no events', () => {
    const spec = createLegacyScreenSpec();
    const ctx = buildTemplateContext(spec, 'testScreens', { screen: true });

    const chat = ctx.screens.find(s => s.screenConst === 'CHAT')!;
    expect(chat.events).toHaveLength(0);
  });

  it('populates new fields with defaults for legacy specs', () => {
    const spec = createLegacyScreenSpec();
    const ctx = buildTemplateContext(spec, 'testScreens', { screen: true });

    const home = ctx.screens.find(s => s.screenConst === 'HOME')!;
    expect(home.screenEvent).toBeUndefined();
    expect(home.actions).toEqual([]);
    expect(home.interactions).toEqual([]);
    expect(home.pathParams).toEqual([]);
  });
});

// =====================================================================
// Inline x-event parser tests
// =====================================================================

describe('Screen Spec - Inline x-event parser', () => {
  it('resolves string form x-event on GET to screenEvent', () => {
    const spec = createInlineEventSpec();
    const ctx = buildTemplateContext(spec, 'test', { screen: true });

    const cal = ctx.screens.find(s => s.screenConst === 'CALENDAR')!;
    expect(cal.screenEvent).toEqual({
      name: 'calendar_view',
      type: 'screen_view',
      params: { yearMonth: 'string' },
    });
  });

  it('resolves object form x-event on GET', () => {
    const spec = createInlineEventSpec();
    const ctx = buildTemplateContext(spec, 'test', { screen: true });

    const detail = ctx.screens.find(s => s.screenConst === 'DETAIL')!;
    expect(detail.screenEvent).toEqual({
      name: 'detail_view',
      type: 'screen_view',
      params: { itemId: 'string' },
    });
  });

  it('resolves $ref form x-event on links', () => {
    const spec = createInlineEventSpec();
    const ctx = buildTemplateContext(spec, 'test', { screen: true });

    const cal = ctx.screens.find(s => s.screenConst === 'CALENDAR')!;
    const linkToDetail = cal.links.find(l => l.name === 'goToDetail')!;
    expect(linkToDetail.event).toEqual({
      name: 'item_tap',
      type: 'user_action',
      params: { itemId: 'string' },
    });
  });

  it('resolves x-event on post action', () => {
    const spec = createInlineEventSpec();
    const ctx = buildTemplateContext(spec, 'test', { screen: true });

    const cal = ctx.screens.find(s => s.screenConst === 'CALENDAR')!;
    const postAction = cal.actions.find(a => a.method === 'post')!;
    expect(postAction.event).toEqual({
      name: 'mode_switch',
      type: 'user_action',
    });
    expect(postAction.operationId).toBe('actionCalendarPage');
  });

  it('resolves x-event on delete action with params', () => {
    const spec = createInlineEventSpec();
    const ctx = buildTemplateContext(spec, 'test', { screen: true });

    const cal = ctx.screens.find(s => s.screenConst === 'CALENDAR')!;
    const deleteAction = cal.actions.find(a => a.method === 'delete')!;
    expect(deleteAction.event).toEqual({
      name: 'item_delete',
      type: 'user_action',
      params: { itemId: 'string' },
    });
  });

  it('collects put/patch/delete as ScreenActions', () => {
    const spec = createInlineEventSpec();
    const ctx = buildTemplateContext(spec, 'test', { screen: true });

    const cal = ctx.screens.find(s => s.screenConst === 'CALENDAR')!;
    const methods = cal.actions.map(a => a.method);
    expect(methods).toContain('post');
    expect(methods).toContain('delete');
  });

  it('allows type override to system', () => {
    const spec = createInlineEventSpec();
    const ctx = buildTemplateContext(spec, 'test', { screen: true });

    const oauth = ctx.screens.find(s => s.screenConst === 'OAUTH_CALLBACK')!;
    expect(oauth.screenEvent).toEqual({
      name: 'oauth_callback_result',
      type: 'system',
      params: { success: 'boolean' },
    });
  });

  it('handles screen with no x-event', () => {
    const spec = createInlineEventSpec();
    const ctx = buildTemplateContext(spec, 'test', { screen: true });

    const simple = ctx.screens.find(s => s.screenConst === 'SIMPLE')!;
    expect(simple.screenEvent).toBeUndefined();
    expect(simple.actions).toEqual([]);
    expect(simple.interactions).toEqual([]);
  });

  it('rejects an x-event $ref with no matching x-event-defs entry', () => {
    const spec = createInlineEventSpec();
    delete (spec.components as any)['x-event-defs'];

    // Inventing the event from the ref name would turn a typo into an event.
    const result = lintSpec(spec, { screen: true });
    expect(result.valid).toBe(false);
    expect(result.errors.map(e => e.code)).toContain('SCREEN_UNKNOWN_EVENT_REF');

    expect(() => buildTemplateContext(spec, 'test', { screen: true })).toThrow(
      /x-event references '#\/components\/x-event-defs\/itemTap'/
    );
  });
});

// =====================================================================
// Params auto-derivation tests
// =====================================================================

describe('Screen Spec - Params auto-derivation', () => {
  it('derives params from GET path for screenEvent', () => {
    const spec = createInlineEventSpec();
    const ctx = buildTemplateContext(spec, 'test', { screen: true });

    const cal = ctx.screens.find(s => s.screenConst === 'CALENDAR')!;
    expect(cal.screenEvent!.params).toEqual({ yearMonth: 'string' });
  });

  it('derives params from link target route', () => {
    const spec = createInlineEventSpec();
    const ctx = buildTemplateContext(spec, 'test', { screen: true });

    const cal = ctx.screens.find(s => s.screenConst === 'CALENDAR')!;
    const link = cal.links.find(l => l.name === 'goToDetail')!;
    expect(link.event!.params).toEqual({ itemId: 'string' });
  });

  it('does NOT auto-derive params for action x-events', () => {
    const spec = createInlineEventSpec();
    const ctx = buildTemplateContext(spec, 'test', { screen: true });

    const cal = ctx.screens.find(s => s.screenConst === 'CALENDAR')!;
    const postAction = cal.actions.find(a => a.method === 'post')!;
    expect(postAction.event!.params).toBeUndefined();
  });

  it('does NOT auto-derive params for interaction x-events', () => {
    const spec = createInlineEventSpec();
    const ctx = buildTemplateContext(spec, 'test', { screen: true });

    const cal = ctx.screens.find(s => s.screenConst === 'CALENDAR')!;
    const swipe = cal.interactions.find(i => i.name === 'daySwipe')!;
    expect(swipe.event!.params).toEqual({ direction: 'string' });
  });

  it('explicit params are not overwritten by auto-derivation', () => {
    const spec = createInlineEventSpec();
    const ctx = buildTemplateContext(spec, 'test', { screen: true });

    const oauth = ctx.screens.find(s => s.screenConst === 'OAUTH_CALLBACK')!;
    expect(oauth.screenEvent!.params).toEqual({ success: 'boolean' });
  });

  it('extracts pathParams for the screen route', () => {
    const spec = createInlineEventSpec();
    const ctx = buildTemplateContext(spec, 'test', { screen: true });

    const cal = ctx.screens.find(s => s.screenConst === 'CALENDAR')!;
    expect(cal.pathParams).toEqual(['yearMonth']);

    const simple = ctx.screens.find(s => s.screenConst === 'SIMPLE')!;
    expect(simple.pathParams).toEqual([]);
  });
});

// =====================================================================
// x-interactions parser tests
// =====================================================================

describe('Screen Spec - x-interactions parser', () => {
  it('maps x-interactions array to ScreenContext.interactions', () => {
    const spec = createInlineEventSpec();
    const ctx = buildTemplateContext(spec, 'test', { screen: true });

    const cal = ctx.screens.find(s => s.screenConst === 'CALENDAR')!;
    expect(cal.interactions).toHaveLength(2);
    expect(cal.interactions[0].name).toBe('daySwipe');
    expect(cal.interactions[0].description).toBe('Horizontal day-by-day swipe navigation');
  });

  it('resolves x-interactions[].x-event as ScreenInteraction.event', () => {
    const spec = createInlineEventSpec();
    const ctx = buildTemplateContext(spec, 'test', { screen: true });

    const cal = ctx.screens.find(s => s.screenConst === 'CALENDAR')!;
    expect(cal.interactions[0].event).toEqual({
      name: 'day_swipe',
      type: 'user_action',
      params: { direction: 'string' },
    });
  });

  it('returns empty interactions when x-interactions is absent', () => {
    const spec = createInlineEventSpec();
    const ctx = buildTemplateContext(spec, 'test', { screen: true });

    const simple = ctx.screens.find(s => s.screenConst === 'SIMPLE')!;
    expect(simple.interactions).toEqual([]);
  });

  it('passes through extra fields into extras', () => {
    const spec = createInlineEventSpec();
    const ctx = buildTemplateContext(spec, 'test', { screen: true });

    const cal = ctx.screens.find(s => s.screenConst === 'CALENDAR')!;
    const itemSelect = cal.interactions.find(i => i.name === 'itemSelect')!;
    expect(itemSelect.extras).toHaveProperty('module', '@ui/selector');
  });
});

// =====================================================================
// Lint rules (legacy + new)
// =====================================================================

describe('Screen Spec - Lint rules (legacy)', () => {
  it('passes lint for valid legacy screen spec in screen mode (with deprecation warning)', () => {
    const spec = createLegacyScreenSpec();
    const result = lintSpec(spec, { screen: true });

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    const deprecations = result.warnings.filter(w => w.code === 'SCREEN_DEPRECATED_X_EVENTS');
    expect(deprecations.length).toBeGreaterThan(0);
  });

  it('suppresses x-micro-contracts-service/method warnings in screen mode', () => {
    const spec = createLegacyScreenSpec();
    const result = lintSpec(spec, { screen: true });

    const serviceWarnings = result.warnings.filter(
      w => w.code === 'MISSING_X_SERVICE' || w.code === 'MISSING_X_METHOD'
    );
    expect(serviceWarnings).toHaveLength(0);
  });

  it('errors on missing x-micro-contracts-service/method without screen mode', () => {
    const spec = createLegacyScreenSpec();
    const result = lintSpec(spec, { screen: false });

    const codes = result.errors.map(e => e.code);
    expect(codes).toContain('MISSING_X_SERVICE');
    expect(codes).toContain('MISSING_X_METHOD');
    expect(result.warnings.map(w => w.code)).not.toContain('MISSING_X_SERVICE');
    expect(result.valid).toBe(false);
  });

  it('errors when x-screen-id present but x-screen-const missing', () => {
    const spec = createLegacyScreenSpec();
    delete (spec.paths['/home'].get as Record<string, unknown>)['x-screen-const'];

    const result = lintSpec(spec, { screen: true });

    expect(result.valid).toBe(false);
    const constErrors = result.errors.filter(e => e.code === 'SCREEN_MISSING_CONST');
    expect(constErrors).toHaveLength(1);
  });

  it('errors when x-screen-id present but x-screen-name missing', () => {
    const spec = createLegacyScreenSpec();
    delete (spec.paths['/home'].get as Record<string, unknown>)['x-screen-name'];

    const result = lintSpec(spec, { screen: true });

    expect(result.valid).toBe(false);
    const nameErrors = result.errors.filter(e => e.code === 'SCREEN_MISSING_NAME');
    expect(nameErrors).toHaveLength(1);
  });

  it('errors when x-screen-id present but operationId missing', () => {
    const spec = createLegacyScreenSpec();
    delete spec.paths['/home'].get!.operationId;

    const result = lintSpec(spec, { screen: true });

    expect(result.valid).toBe(false);
    const opIdErrors = result.errors.filter(e => e.code === 'SCREEN_MISSING_OPERATION_ID');
    expect(opIdErrors).toHaveLength(1);
  });

  it('errors on invalid x-events (not an array)', () => {
    const spec = createLegacyScreenSpec();
    (spec.paths['/home'].get as Record<string, unknown>)['x-events'] = 'not-an-array';

    const result = lintSpec(spec, { screen: true });

    expect(result.valid).toBe(false);
    const eventErrors = result.errors.filter(e => e.code === 'SCREEN_INVALID_EVENTS');
    expect(eventErrors).toHaveLength(1);
  });

  it('errors on x-events item missing required fields', () => {
    const spec = createLegacyScreenSpec();
    (spec.paths['/home'].get as Record<string, unknown>)['x-events'] = [
      { name: 'test_event' }, // missing type
    ];

    const result = lintSpec(spec, { screen: true });

    expect(result.valid).toBe(false);
    const eventErrors = result.errors.filter(e => e.code === 'SCREEN_INVALID_EVENT');
    expect(eventErrors).toHaveLength(1);
  });
});

describe('Screen Spec - Lint rules (inline x-event)', () => {
  it('passes lint for valid inline x-event spec', () => {
    const spec = createInlineEventSpec();
    const result = lintSpec(spec, { screen: true });

    expect(result.errors).toHaveLength(0);
    expect(result.valid).toBe(true);
  });

  it('emits deprecation warning for x-events', () => {
    const spec = createLegacyScreenSpec();
    const result = lintSpec(spec, { screen: true });

    const deprecations = result.warnings.filter(w => w.code === 'SCREEN_DEPRECATED_X_EVENTS');
    expect(deprecations.length).toBeGreaterThan(0);
  });

  it('errors on x-event with invalid type (number)', () => {
    const spec = createInlineEventSpec();
    (spec.paths['/simple'].get as Record<string, unknown>)['x-event'] = 42;

    const result = lintSpec(spec, { screen: true });

    const errs = result.errors.filter(e => e.code === 'SCREEN_INVALID_X_EVENT');
    expect(errs).toHaveLength(1);
  });

  it('errors on x-event object without name or $ref', () => {
    const spec = createInlineEventSpec();
    (spec.paths['/simple'].get as Record<string, unknown>)['x-event'] = { type: 'user_action' };

    const result = lintSpec(spec, { screen: true });

    const errs = result.errors.filter(e => e.code === 'SCREEN_INVALID_X_EVENT');
    expect(errs).toHaveLength(1);
  });

  it('errors when x-events and x-event coexist', () => {
    const spec = createInlineEventSpec();
    const calGet = spec.paths['/calendar/{yearMonth}'].get as Record<string, unknown>;
    calGet['x-events'] = [{ name: 'old', type: 'screen_view', method: 'track' }];

    const result = lintSpec(spec, { screen: true });

    const conflicts = result.errors.filter(e => e.code === 'SCREEN_CONFLICTING_EVENT_DEFS');
    expect(conflicts.length).toBeGreaterThanOrEqual(1);
  });

  it('validates x-event on links', () => {
    const spec = createInlineEventSpec();
    const calGet = spec.paths['/calendar/{yearMonth}'].get as any;
    calGet.responses['200'].links.goToDetail['x-event'] = 42;

    const result = lintSpec(spec, { screen: true });

    const errs = result.errors.filter(e => e.code === 'SCREEN_INVALID_X_EVENT');
    expect(errs.length).toBeGreaterThanOrEqual(1);
  });

  it('errors when x-interactions is not an array', () => {
    const spec = createInlineEventSpec();
    (spec.paths['/calendar/{yearMonth}'].get as Record<string, unknown>)['x-interactions'] = 'bad';

    const result = lintSpec(spec, { screen: true });

    const errs = result.errors.filter(e => e.code === 'SCREEN_INVALID_INTERACTIONS');
    expect(errs).toHaveLength(1);
  });

  it('errors when x-interactions entry lacks name', () => {
    const spec = createInlineEventSpec();
    (spec.paths['/calendar/{yearMonth}'].get as Record<string, unknown>)['x-interactions'] = [
      { description: 'missing name' },
    ];

    const result = lintSpec(spec, { screen: true });

    const errs = result.errors.filter(e => e.code === 'SCREEN_INVALID_INTERACTION');
    expect(errs).toHaveLength(1);
  });

  it('validates x-event inside x-interactions entries', () => {
    const spec = createInlineEventSpec();
    (spec.paths['/calendar/{yearMonth}'].get as Record<string, unknown>)['x-interactions'] = [
      { name: 'swipe', 'x-event': 42 },
    ];

    const result = lintSpec(spec, { screen: true });

    const errs = result.errors.filter(e => e.code === 'SCREEN_INVALID_X_EVENT');
    expect(errs.length).toBeGreaterThanOrEqual(1);
  });
});

// =====================================================================
// Template rendering
// =====================================================================

describe('Screen Spec - Template rendering (legacy)', () => {
  it('renders navigation template with screens context', () => {
    const spec = createLegacyScreenSpec();
    const ctx = buildTemplateContext(spec, 'testScreens', { screen: true });

    const templateSource = `{{#each screens}}
SCREEN: {{screenConst}} -> {{route}} ({{screenId}})
{{#each links}}
  LINK: {{name}} -> {{targetRoute}}
{{/each}}
{{/each}}`;

    const template = Handlebars.compile(templateSource);
    const output = template(ctx);

    expect(output).toContain('SCREEN: HOME -> /home (SCR-001)');
    expect(output).toContain('LINK: goToSettings -> /settings');
    expect(output).toContain('LINK: goToChat -> /chat');
    expect(output).toContain('SCREEN: SETTINGS -> /settings (SCR-002)');
  });

  it('renders events template with screens context', () => {
    const spec = createLegacyScreenSpec();
    const ctx = buildTemplateContext(spec, 'testScreens', { screen: true });

    const templateSource = `{{#each screens}}
{{#if events.length}}
{{screenName}} events:
{{#each events}}
  - {{method}}({{name}})
{{/each}}
{{/if}}
{{/each}}`;

    const template = Handlebars.compile(templateSource);
    const output = template(ctx);

    expect(output).toContain('HomePage events:');
    expect(output).toContain('- trackView(home_view)');
    expect(output).toContain('- trackSignOut(sign_out)');
    expect(output).toContain('SettingsPage events:');
  });
});

describe('Screen Spec - Template rendering (inline x-event)', () => {
  it('renders screenEvent in template', () => {
    const spec = createInlineEventSpec();
    const ctx = buildTemplateContext(spec, 'test', { screen: true });

    const tmpl = Handlebars.compile(`{{#each screens}}{{#if screenEvent}}
SCREEN_EVENT: {{screenName}} -> {{screenEvent.name}} ({{screenEvent.type}})
{{/if}}{{/each}}`);
    const output = tmpl(ctx);

    expect(output).toContain('SCREEN_EVENT: CalendarPage -> calendar_view (screen_view)');
    expect(output).toContain('SCREEN_EVENT: OAuthCallbackPage -> oauth_callback_result (system)');
  });

  it('renders link events in template', () => {
    const spec = createInlineEventSpec();
    const ctx = buildTemplateContext(spec, 'test', { screen: true });

    const tmpl = Handlebars.compile(`{{#each screens}}{{#each links}}{{#if this.event}}
LINK_EVENT: {{this.name}} -> {{this.event.name}}
{{/if}}{{/each}}{{/each}}`);
    const output = tmpl(ctx);

    expect(output).toContain('LINK_EVENT: goToDetail -> item_tap');
  });

  it('renders action events in template', () => {
    const spec = createInlineEventSpec();
    const ctx = buildTemplateContext(spec, 'test', { screen: true });

    const tmpl = Handlebars.compile(`{{#each screens}}{{#each actions}}{{#if this.event}}
ACTION_EVENT: {{this.method}} {{this.operationId}} -> {{this.event.name}}
{{/if}}{{/each}}{{/each}}`);
    const output = tmpl(ctx);

    expect(output).toContain('ACTION_EVENT: post actionCalendarPage -> mode_switch');
    expect(output).toContain('ACTION_EVENT: delete deleteCalendarItem -> item_delete');
  });

  it('renders interaction events in template', () => {
    const spec = createInlineEventSpec();
    const ctx = buildTemplateContext(spec, 'test', { screen: true });

    const tmpl = Handlebars.compile(`{{#each screens}}{{#each interactions}}{{#if this.event}}
INTERACTION: {{this.name}} -> {{this.event.name}}
{{/if}}{{/each}}{{/each}}`);
    const output = tmpl(ctx);

    expect(output).toContain('INTERACTION: daySwipe -> day_swipe');
    expect(output).toContain('INTERACTION: itemSelect -> item_select');
  });

  it('hasEvent helper works', () => {
    const spec = createInlineEventSpec();
    const ctx = buildTemplateContext(spec, 'test', { screen: true });

    const tmpl = Handlebars.compile(`{{#each screens}}{{#if (hasEvent this)}}HAS:{{screenConst}} {{/if}}{{/each}}`);
    const output = tmpl(ctx);

    expect(output).toContain('HAS:CALENDAR');
    expect(output).toContain('HAS:OAUTH_CALLBACK');
    expect(output).not.toContain('HAS:SIMPLE');
  });

  it('eventParamsSignature helper works', () => {
    const spec = createInlineEventSpec();
    const ctx = buildTemplateContext(spec, 'test', { screen: true });

    const tmpl = Handlebars.compile(`{{#each screens}}{{#if screenEvent}}{{eventParamsSignature screenEvent.params}}|{{/if}}{{/each}}`);
    const output = tmpl(ctx);

    expect(output).toContain('yearMonth: string');
    expect(output).toContain('success: boolean');
  });
});

// =====================================================================
// Module config
// =====================================================================

describe('Screen Spec - Module config', () => {
  it('resolves screen: true in module config', () => {
    const resolved = resolveModuleConfig('myScreens', {
      openapi: 'spec/screens/screens.yaml',
      screen: true,
    });

    expect(resolved.screen).toBe(true);
  });

  it('resolves screen: false by default', () => {
    const resolved = resolveModuleConfig('api', {
      openapi: 'spec/api/openapi.yaml',
    });

    expect(resolved.screen).toBe(false);
  });
});
