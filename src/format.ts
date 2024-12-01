import { FormatRegistry } from '@sinclair/typebox';

if (!FormatRegistry.Has('url'))
    FormatRegistry.Set('url', URL.canParse);
