// emails/MicroMessageEmail.tsx
// E-mailový fallback mikrozprávy (rodič bez aktivního push odběru, PRD D5/E1).
// Bez sledovacího pixelu; stav „otevřeno" se počítá jen z /z/{token} (JS beacon).

import { Body, Button, Container, Head, Hr, Html, Preview, Section, Text } from '@react-email/components'
import * as React from 'react'

interface MicroMessageEmailProps {
  body: string
  groupLabel: string
  url: string
  needsAck: boolean
  urgent: boolean
  linkUrl?: string | null
  schoolPhone?: string | null
  pollCloseText?: string | null
  repliesEnabled?: boolean
  schoolName?: string
}

export const MicroMessageEmail: React.FC<MicroMessageEmailProps> = ({
  body, groupLabel, url, needsAck, urgent, linkUrl, schoolPhone, pollCloseText, repliesEnabled, schoolName = 'ZŠ Vilekula Teplice',
}) => (
  <Html lang="cs">
    <Head />
    <Preview>{(urgent ? '⚡ ' : '') + body.slice(0, 120)}</Preview>
    <Body style={{ backgroundColor: '#f6f6f4', fontFamily: 'Helvetica, Arial, sans-serif', margin: 0, padding: '24px 0' }}>
      <Container style={{ backgroundColor: '#ffffff', borderRadius: 12, maxWidth: 520, padding: '24px 28px' }}>
        <Text style={{ color: urgent ? '#dc2626' : '#0f6e56', fontSize: 13, fontWeight: 600, margin: '0 0 8px' }}>
          {urgent ? '⚡ Naléhavá zpráva · ' : ''}{schoolName} · {groupLabel}
        </Text>
        <Text style={{ color: '#1f2937', fontSize: 17, lineHeight: '26px', margin: '0 0 20px', whiteSpace: 'pre-wrap' }}>
          {body}
        </Text>
        {pollCloseText && (
          <Text style={{ color: '#374151', fontSize: 14, margin: '0 0 16px' }}>Hlasovat můžete do {pollCloseText}.</Text>
        )}
        {linkUrl && (
          <Text style={{ fontSize: 14, margin: '0 0 20px' }}>
            <a href={linkUrl} style={{ color: '#0f6e56' }} rel="noopener noreferrer">{linkUrl}</a>
          </Text>
        )}
        <Section style={{ margin: '0 0 8px' }}>
          <Button
            href={url}
            style={{
              backgroundColor: urgent ? '#dc2626' : '#0f6e56', borderRadius: 8, color: '#ffffff',
              fontSize: 15, fontWeight: 600, padding: '12px 20px', textDecoration: 'none',
            }}
          >
            {pollCloseText ? '📊 Hlasovat' : needsAck ? '👍 Beru na vědomí' : 'Otevřít zprávu'}
          </Button>
        </Section>
        <Hr style={{ borderColor: '#e5e7eb', margin: '24px 0 12px' }} />
        <Text style={{ color: '#6b7280', fontSize: 12, lineHeight: '18px', margin: 0 }}>
          {repliesEnabled ? 'Na tento e-mail můžete odpovědět — odpověď uvidí tým školy.' : 'Odpověď na tento e-mail zatím nikdo nečte.'}
          {schoolPhone ? ` V naléhavém případě volejte ${schoolPhone}.` : ''}
          {' '}Zprávy vám můžou chodit rovnou do telefonu — zapněte si upozornění v rodičovském portálu.
        </Text>
      </Container>
    </Body>
  </Html>
)
