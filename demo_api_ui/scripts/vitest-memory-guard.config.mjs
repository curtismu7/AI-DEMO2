import viteConfig from '../vite.config.js'

export const VITEST_WORKER_HEAP_LIMIT_MB = 1_400
export const VITEST_MAX_WORKERS = 2

export function applyVitestMemoryLimits(config) {
  const test = config?.test ?? {}
  const poolOptions = test.poolOptions ?? {}

  return {
    ...config,
    test: {
      ...test,
      pool: 'forks',
      maxWorkers: VITEST_MAX_WORKERS,
      poolOptions: {
        ...poolOptions,
        forks: {
          ...poolOptions.forks,
          execArgv: [`--max-old-space-size=${VITEST_WORKER_HEAP_LIMIT_MB}`],
          maxForks: VITEST_MAX_WORKERS,
          minForks: 1,
        },
      },
    },
  }
}

export default async (configEnv) => {
  const config = typeof viteConfig === 'function'
    ? await viteConfig(configEnv)
    : viteConfig

  return applyVitestMemoryLimits(config)
}
