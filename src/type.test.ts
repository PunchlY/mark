import { test, expect } from 'bun:test';
import { FormatRegistry, Type } from '@sinclair/typebox';
import { Check } from '@sinclair/typebox/value';

test('url', () => {
    FormatRegistry.Set('url', URL.canParse);
    const schema = Type.String({ format: 'url' });

    expect(Check(schema, 'https://example.com')).toBeTrue();
    expect(Check(schema, 'rss://example.com')).toBeTrue();

    expect(Check(schema, 'example.com')).toBeFalse();
});

test('attribute-name', () => {
    FormatRegistry.Set('attribute-name', RegExp.prototype.test.bind(/^[^ \s/>=]+$/));
    const schema = Type.String({ format: 'attribute-name' });

    expect(Check(schema, '')).toBeFalse();
    expect(Check(schema, ' ')).toBeFalse();
    expect(Check(schema, '\n')).toBeFalse();
    expect(Check(schema, '\r')).toBeFalse();
    expect(Check(schema, '\t')).toBeFalse();
    expect(Check(schema, '\f')).toBeFalse();
    expect(Check(schema, '/')).toBeFalse();
    expect(Check(schema, '>')).toBeFalse();
    expect(Check(schema, '=')).toBeFalse();


    expect(Check(schema, 'foo')).toBeTrue();
    expect(Check(schema, 'bar')).toBeTrue();
    expect(Check(schema, 'foo-bar')).toBeTrue();

    const attribute = '%~`!@#$%^&*()_+[]{}|;:\'",.<?';
    expect(Check(schema, attribute)).toBeTrue();
    expect(new HTMLRewriter()
        .on(`[${attribute.replace(/[^a-zA-Z0-9]/g, '\\$&')}]`, {
            element(element) {
                element.removeAttribute(attribute);
            },
        })
        .transform(`<a ${attribute}></a>`)
    ).toBe('<a></a>');
});
