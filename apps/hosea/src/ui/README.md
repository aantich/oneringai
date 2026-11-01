# Hosea local UI

These UI components and the main-process DynamicUI plugin are part of Hosea,
licensed under the [Hosea MIT license](../../LICENSE), Copyright (c) 2025-2026
Anton Antic <anton.antich@gmail.com>.

The owner authorized migration and MIT licensing from `Integrail/react-ui`,
commit `51f1050fc93a4c07089fedafd3beca2abec81b1e`, on 2026-11-01. This is an owned-source migration,
not redistribution under the former commercial dependency's license.

Hosea now imports this source directly. There is no separate React UI package,
Git dependency, remote prepare/build step or duplicate OneRingAI dependency.
Keep renderer exports in `index.ts` separate from the main-process `plugins.ts`
entry so renderer bundles do not import the agent runtime. Third-party dependency
licenses remain unchanged.
