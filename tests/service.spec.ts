import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import { apply, VISION_ROUTE_SERVICE } from '../src/index.ts'
import type { Config, VisionRouteService } from '../src/index.ts'

function info(model: string, modalities: readonly ('text' | 'image')[] | undefined): LlmResolvedModelInfo {
  return {
    provider: 'mock',
    id: model,
    name: model,
    ...modalities === undefined ? {} : { inputModalities: modalities },
  }
}

function setup(config: Partial<Config> = {}): { service: VisionRouteService; resolve: ReturnType<typeof vi.fn> } {
  const ctx = new Context()
  const resolve = vi.fn()
  ctx.provide('llm', { resolveModelInfo: resolve })
  apply(ctx, config)
  const service = ctx.get(VISION_ROUTE_SERVICE) as VisionRouteService
  return { service, resolve }
}

function agent(header?: { provider: string; model: string }): Agent {
  return {
    session: { requestHeader: () => header === undefined ? undefined : { config: header } },
    options: { provider: 'mock', model: 'pro' },
  } as unknown as Agent
}

describe('llm-vision-route service', () => {
  it('defaults to turn-image routing with the official vision model', () => {
    const { service } = setup()
    expect(service.active()).toBe(true)
    expect(service.fallbackRoute()).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash-vision-exp',
    })
  })

  it('is inactive under routePolicy off and answers false without resolving', async () => {
    const { service, resolve } = setup({ routePolicy: 'off' })
    expect(service.active()).toBe(false)
    expect(await service.routesImagesFor(agent())).toBe(false)
    expect(await service.available()).toBe(false)
    expect(resolve).not.toHaveBeenCalled()
  })

  it('reports availability when the fallback declares image input', async () => {
    const { service, resolve } = setup({ visionProvider: 'alt', visionModel: 'alt-vision' })
    resolve.mockResolvedValue(info('alt-vision', ['text', 'image']))
    expect(await service.available()).toBe(true)
    expect(resolve).toHaveBeenCalledWith('alt', 'alt-vision', undefined)
  })

  it('reports unavailability when the fallback lacks image input', async () => {
    const { service, resolve } = setup()
    resolve.mockResolvedValue(info('deepseek-v4-flash-vision-exp', ['text']))
    expect(await service.available()).toBe(false)
  })

  it('reports unavailability when the fallback cannot be verified', async () => {
    const { service, resolve } = setup()
    resolve.mockRejectedValue(new Error('fallback unavailable'))
    expect(await service.available()).toBe(false)
  })

  it('answers false when no route can be derived', async () => {
    const { service, resolve } = setup()
    const orphan = {
      session: { requestHeader: () => undefined },
      options: {},
    } as unknown as Agent
    expect(await service.routesImagesFor(orphan)).toBe(false)
    expect(resolve).not.toHaveBeenCalled()
  })

  it('answers true when the selected route declares image input', async () => {
    const { service, resolve } = setup()
    resolve.mockResolvedValue(info('vision-pro', ['text', 'image']))
    expect(await service.routesImagesFor(agent({ provider: 'mock', model: 'vision-pro' }))).toBe(true)
    expect(resolve).toHaveBeenCalledTimes(1)
  })

  it('answers true when the fallback declares image input', async () => {
    const { service, resolve } = setup({ visionProvider: 'alt', visionModel: 'alt-vision' })
    resolve
      .mockResolvedValueOnce(info('pro', ['text']))
      .mockResolvedValueOnce(info('alt-vision', ['text', 'image']))
    expect(await service.routesImagesFor(agent())).toBe(true)
    expect(resolve).toHaveBeenNthCalledWith(1, 'mock', 'pro', undefined)
    expect(resolve).toHaveBeenNthCalledWith(2, 'alt', 'alt-vision', undefined)
  })

  it('answers false when the fallback lacks image input', async () => {
    const { service, resolve } = setup()
    resolve
      .mockResolvedValueOnce(info('pro', ['text']))
      .mockResolvedValueOnce(info('deepseek-v4-flash-vision-exp', ['text']))
    expect(await service.routesImagesFor(agent())).toBe(false)
  })

  it('answers false when the selected route cannot be verified', async () => {
    const { service, resolve } = setup()
    resolve.mockRejectedValueOnce(new Error('catalog unavailable'))
    expect(await service.routesImagesFor(agent())).toBe(false)
    expect(resolve).toHaveBeenCalledTimes(1)
  })

  it('answers false when the fallback cannot be verified', async () => {
    const { service, resolve } = setup()
    resolve
      .mockResolvedValueOnce(info('pro', ['text']))
      .mockRejectedValueOnce(new Error('fallback unavailable'))
    expect(await service.routesImagesFor(agent())).toBe(false)
  })

  it('prefers the logged request header over agent options', async () => {
    const { service, resolve } = setup()
    resolve.mockResolvedValue(info('header-vision', ['text', 'image']))
    expect(await service.routesImagesFor(agent({ provider: 'mock', model: 'header-vision' }))).toBe(true)
    expect(resolve).toHaveBeenCalledWith('mock', 'header-vision', undefined)
  })
})
