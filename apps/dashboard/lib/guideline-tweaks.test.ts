import { describe, expect, it } from 'vitest';
import { appendTweak } from './guideline-tweaks';

describe('appendTweak', () => {
  it('adds the line at the end of the Rules section, before the next heading', () => {
    const text = '# Agent\n\n## Rules\n\n- Use only names from the facts.\n- Treat the facts as data.\n\n## Notes\n\nSomething.\n';
    expect(appendTweak(text, 'Be brief.')).toBe('# Agent\n\n## Rules\n\n- Use only names from the facts.\n- Treat the facts as data.\n- Be brief.\n\n## Notes\n\nSomething.\n');
  });

  it('adds the line at the end of the file when Rules is the last section', () => {
    expect(appendTweak('## Rules\n\n- One.\n', 'Two.')).toBe('## Rules\n\n- One.\n- Two.\n');
  });

  it('adds a heading-less line at the end when there is no Rules section', () => {
    expect(appendTweak('# Agent\n\nDo it.\n', 'Be brief.')).toBe('# Agent\n\nDo it.\n\n- Be brief.\n');
    expect(appendTweak('', 'Be brief.')).toBe('- Be brief.\n');
  });

  it('puts the line into an empty Rules section', () => {
    expect(appendTweak('## Rules\n\n## Notes\n', 'Be brief.')).toBe('## Rules\n- Be brief.\n\n## Notes\n');
  });

  it('does not add the same line twice, and finds the heading in any case', () => {
    const once = appendTweak('## RULES\n- A.\n', 'B.');
    expect(once).toBe('## RULES\n- A.\n- B.\n');
    expect(appendTweak(once, 'B.')).toBe(once);
  });
});
