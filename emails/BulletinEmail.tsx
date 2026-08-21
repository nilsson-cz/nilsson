// emails/BulletinEmail.tsx
// React Email šablona pro příspěvky nástěnky ZŠ Vilekula Teplice.
// Použití: Resend.emails.send({ react: <BulletinEmail ... /> })

import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
  Row,
  Column,
} from '@react-email/components';
import { renderMarkdown } from '@/app/zivot/_lib/markdown';
import * as React from 'react';

interface BulletinEmailProps {
  title:        string;
  body:         string;           // Markdown
  type:         'message' | 'event';
  validUntil:   string;           // ISO date
  eventDate?:   string | null;    // ISO datetime
  eventLocation?: string | null;
  schoolName?:  string;
}

const defaultSchoolName = 'ZŠ Vilekula Teplice';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('cs-CZ', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
}

function formatDatetime(iso: string): string {
  return new Date(iso).toLocaleString('cs-CZ', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export const BulletinEmail: React.FC<BulletinEmailProps> = ({
  title,
  body,
  type,
  validUntil,
  eventDate,
  eventLocation,
  schoolName = defaultSchoolName,
}) => {
  // Markdown → sanitizované HTML (renderMarkdown = marked + DOMPurify allowlist).
  const bodyHtml = renderMarkdown(body);

  const previewText = type === 'event'
    ? `📅 Akce: ${title}`
    : `📋 Zpráva ze školy: ${title}`;

  return (
    <Html lang="cs" dir="ltr">
      <Head />
      <Preview>{previewText}</Preview>

      <Body style={styles.body}>
        {/* ── Hlavička ── */}
        <Container style={styles.wrapper}>
          <Section style={styles.header}>
            <Text style={styles.schoolLabel}>{schoolName}</Text>
            <Text style={styles.headerSub}>
              {type === 'event' ? '📅 Pozvánka na akci' : '📋 Zpráva z nástěnky'}
            </Text>
          </Section>

          {/* ── Název ── */}
          <Section style={styles.content}>
            <Heading as="h1" style={styles.title}>{title}</Heading>

            {/* ── Blok akce ── */}
            {type === 'event' && (eventDate || eventLocation) && (
              <Section style={styles.eventBox}>
                <Row>
                  <Column>
                    {eventDate && (
                      <Text style={styles.eventField}>
                        <span style={styles.eventIcon}>🗓</span>{' '}
                        <strong>Datum:</strong>{' '}
                        {formatDatetime(eventDate)}
                      </Text>
                    )}
                    {eventLocation && (
                      <Text style={styles.eventField}>
                        <span style={styles.eventIcon}>📍</span>{' '}
                        <strong>Místo:</strong>{' '}
                        {eventLocation}
                      </Text>
                    )}
                  </Column>
                </Row>
              </Section>
            )}

            {/* ── Tělo (Markdown → HTML) ── */}
            <Section style={styles.bodySection}>
              <div
                dangerouslySetInnerHTML={{ __html: bodyHtml }}
                style={styles.markdownBody}
              />
            </Section>

            <Hr style={styles.divider} />

            {/* ── Platnost ── */}
            <Text style={styles.validUntilText}>
              Příspěvek je platný do{' '}
              <strong>{formatDate(validUntil)}</strong>.
            </Text>
          </Section>

          {/* ── Patička ── */}
          <Section style={styles.footer}>
            <Text style={styles.footerText}>
              Tuto zprávu najdete vždy v systému{' '}
              <strong>Nilsson</strong>.
            </Text>
            <Text style={styles.footerText}>
              Zprávu obdrželi zákonní zástupci žáků{' '}
              <strong>{schoolName}</strong>.
            </Text>
            <Text style={{ ...styles.footerText, ...styles.footerSmall }}>
              Pokud si myslíte, že jste tuto zprávu dostali omylem,
              prosím kontaktujte školu.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

export default BulletinEmail;

// ─────────────────────────────────────────────────────────────
// Inline styly – zemitá/zelená paleta, ne korporátní
// ─────────────────────────────────────────────────────────────

const colors = {
  forest:     '#2d6a4f',   // tmavá zelená – hlavička
  fern:       '#40916c',   // střední zelená
  sage:       '#d8f3dc',   // světlá zelená – pozadí akcí
  sand:       '#f8f4ef',   // teplý bílý – pozadí
  bark:       '#5c4a37',   // hnědá – text
  muted:      '#7f6e5c',   // ztlumená hnědá
  divider:    '#d4c5b5',
  white:      '#ffffff',
};

const styles: Record<string, React.CSSProperties> = {
  body: {
    backgroundColor: colors.sand,
    fontFamily: '"Georgia", "Times New Roman", serif',
    margin: 0,
    padding: '24px 0',
  },
  wrapper: {
    maxWidth: '600px',
    margin: '0 auto',
    backgroundColor: colors.white,
    borderRadius: '8px',
    overflow: 'hidden',
    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
  },
  header: {
    backgroundColor: colors.forest,
    padding: '28px 36px 24px',
    textAlign: 'center',
  },
  schoolLabel: {
    color: colors.white,
    fontSize: '22px',
    fontWeight: 'bold',
    margin: '0 0 4px',
    letterSpacing: '0.03em',
  },
  headerSub: {
    color: 'rgba(255,255,255,0.80)',
    fontSize: '14px',
    margin: 0,
  },
  content: {
    padding: '32px 36px 20px',
  },
  title: {
    color: colors.bark,
    fontSize: '24px',
    fontWeight: 'bold',
    margin: '0 0 20px',
    lineHeight: '1.3',
  },
  eventBox: {
    backgroundColor: colors.sage,
    border: `1px solid ${colors.fern}`,
    borderRadius: '6px',
    padding: '14px 18px',
    marginBottom: '24px',
  },
  eventField: {
    color: colors.bark,
    fontSize: '15px',
    margin: '4px 0',
  },
  eventIcon: {
    display: 'inline-block',
    width: '20px',
  },
  bodySection: {
    marginBottom: '8px',
  },
  markdownBody: {
    color: colors.bark,
    fontSize: '16px',
    lineHeight: '1.7',
  },
  divider: {
    borderColor: colors.divider,
    margin: '24px 0 16px',
  },
  validUntilText: {
    color: colors.muted,
    fontSize: '13px',
    margin: '0 0 8px',
  },
  footer: {
    backgroundColor: '#f0ebe4',
    padding: '20px 36px',
    borderTop: `1px solid ${colors.divider}`,
  },
  footerText: {
    color: colors.muted,
    fontSize: '13px',
    margin: '0 0 6px',
    lineHeight: '1.5',
  },
  footerSmall: {
    fontSize: '11px',
    marginTop: '8px',
  },
};
