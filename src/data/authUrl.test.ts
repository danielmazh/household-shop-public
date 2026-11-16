import { describe, expect, it } from 'vitest';
import { inviteLink, readAuthUrl, readJoinParam } from './authUrl';

describe('readAuthUrl', () => {
  it('reads an error from the hash and removes it', () => {
    const r = readAuthUrl('https://app.example/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid');
    expect(r).toEqual({ error: 'otp_expired', hadCode: false, clean: 'https://app.example/' });
  });

  it('reads an error from the query and keeps other params', () => {
    const r = readAuthUrl('https://app.example/?error=server_error&x=1');
    expect(r).toEqual({ error: 'server_error', hadCode: false, clean: 'https://app.example/?x=1' });
  });

  it('removes a used code without an error', () => {
    expect(readAuthUrl('https://app.example/?code=abc')).toEqual({ error: null, hadCode: true, clean: 'https://app.example/' });
  });

  it('leaves a plain address alone', () => {
    expect(readAuthUrl('https://app.example/#top')).toEqual({ error: null, hadCode: false, clean: null });
  });
});

describe('readJoinParam', () => {
  it('reads the code and removes the param', () => {
    expect(readJoinParam('https://app.example/?join=ab12-cd34&x=1')).toEqual({ code: 'AB12CD34', clean: 'https://app.example/?x=1' });
  });

  it('does nothing without the param', () => {
    expect(readJoinParam('https://app.example/')).toEqual({ code: null, clean: null });
  });

  it('builds an invite link that reads back', () => {
    expect(readJoinParam(inviteLink('https://app.example', 'ABCD1234')).code).toBe('ABCD1234');
  });
});
