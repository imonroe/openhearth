import { describe, it, expect } from 'vitest';
import { serviceSchema, serviceJsonSchema } from './index';

describe('serviceSchema', () => {
  it('accepts a minimal valid service', () => {
    const result = serviceSchema.safeParse({
      id: 'netflix',
      name: 'Netflix',
      launch_url: 'https://www.netflix.com/',
    });
    expect(result.success).toBe(true);
  });

  it('accepts all optional fields including null user_agent/notes', () => {
    const result = serviceSchema.safeParse({
      id: 'yt',
      name: 'YouTube',
      launch_url: 'https://www.youtube.com/tv',
      icon: 'yt.png',
      group: 'Streaming',
      order: 20,
      user_agent: null,
      notes: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-URL launch_url', () => {
    expect(serviceSchema.safeParse({ id: 'a', name: 'A', launch_url: 'nope' }).success).toBe(false);
  });

  it('rejects dangerous launch_url schemes (only http/https allowed)', () => {
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,<script>1</script>',
      'file:///etc/passwd',
      'vbscript:msgbox(1)',
      'ftp://host/file',
    ]) {
      expect(serviceSchema.safeParse({ id: 'a', name: 'A', launch_url: url }).success).toBe(false);
    }
    expect(serviceSchema.safeParse({ id: 'a', name: 'A', launch_url: 'http://x/' }).success).toBe(
      true,
    );
    expect(serviceSchema.safeParse({ id: 'a', name: 'A', launch_url: 'https://x/' }).success).toBe(
      true,
    );
  });

  it('rejects an empty id and unknown fields (strict)', () => {
    expect(serviceSchema.safeParse({ id: '', name: 'A', launch_url: 'https://a/' }).success).toBe(
      false,
    );
    expect(
      serviceSchema.safeParse({ id: 'a', name: 'A', launch_url: 'https://a/', x: 1 }).success,
    ).toBe(false);
  });

  it('accepts safe icons and rejects dangerous ones', () => {
    const ok = (icon: string): boolean =>
      serviceSchema.safeParse({ id: 'a', name: 'A', launch_url: 'https://a/', icon }).success;
    // Allowed: http(s) URLs and safe relative filenames.
    expect(ok('https://cdn/x.png')).toBe(true);
    expect(ok('netflix.png')).toBe(true);
    expect(ok('icons/netflix.png')).toBe(true);
    // Rejected: other schemes, absolute paths, traversal.
    expect(ok('javascript:alert(1)')).toBe(false);
    expect(ok('data:image/svg+xml,<svg/>')).toBe(false);
    expect(ok('file:///etc/passwd')).toBe(false);
    expect(ok('/etc/passwd')).toBe(false);
    expect(ok('../../secret.yaml')).toBe(false);
  });

  it('emits a JSON Schema', () => {
    expect(serviceJsonSchema).toBeTypeOf('object');
  });
});
