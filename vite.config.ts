import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  server: {
    host: '127.0.0.1',
    fs: {
      strict: true,
      allow: ['.']
    }
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['luxe-icon.svg', 'offline.html'],
      manifest: {
        name: 'Luxe Hair — Mega Hair Premium',
        short_name: 'Luxe Hair',
        description: 'Sua jornada completa de transformação, cuidado e manutenção do Mega Hair.',
        theme_color: '#181511',
        background_color: '#faf8f3',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/',
        lang: 'pt-BR',
        categories: ['beauty', 'lifestyle', 'business'],
        icons: [
          { src: '/luxe-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: '/luxe-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' }
        ],
        shortcuts: [
          { name: 'Agendar', short_name: 'Agendar', url: '/cliente/agenda', icons: [{ src: '/luxe-icon.svg', sizes: 'any', type: 'image/svg+xml' }] },
          { name: 'Minha agenda', short_name: 'Agenda', url: '/cliente/agenda', icons: [{ src: '/luxe-icon.svg', sizes: 'any', type: 'image/svg+xml' }] }
        ]
      },
      workbox: {
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/images\.unsplash\.com\//,
            handler: 'CacheFirst',
            options: { cacheName: 'luxe-images', expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 30 } }
          }
        ]
      }
    })
  ]
})
