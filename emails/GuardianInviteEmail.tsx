// emails/GuardianInviteEmail.tsx
// React Email šablona pro pozvánku druhého zákonného zástupce k žádosti
// o zápis/přestup. Stylově sjednoceno s emails/BulletinEmail.tsx (stejná
// paleta, stejná struktura hlavička/patička) — viz ta šablona pro
// referenci barev a fontu.
//
// Použití: Resend.emails.send({ react: <GuardianInviteEmail ... /> })

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import * as React from 'react';

interface GuardianInviteEmailProps {
  childName:      string;   // "Jan Novák"
  inviteeName?:   string | null;   // oslovení, pokud známe jméno pozvaného
  inviteUrl:      string;
  ownerName?:     string | null;   // jméno vlastníka žádosti, co pozvánku odeslal
  schoolName?:    string;
}

const defaultSchoolName = 'ZŠ Vilekula Teplice';

export const GuardianInviteEmail: React.FC<GuardianInviteEmailProps> = ({
  childName,
  inviteeName,
  inviteUrl,
  ownerName,
  schoolName = defaultSchoolName,
}) => {
  const previewText = `Pozvánka k žádosti o zápis — ${childName}`;
  const greeting = inviteeName ? `Dobrý den, ${inviteeName},` : 'Dobrý den,';

  return (
    <Html lang="cs" dir="ltr">
      <Head />
      <Preview>{previewText}</Preview>

      <Body style={styles.body}>
        <Container style={styles.wrapper}>
          {/* ── Hlavička ── */}
          <Section style={styles.header}>
            <Text style={styles.schoolLabel}>{schoolName}</Text>
            <Text style={styles.headerSub}>✉️ Pozvánka k žádosti o zápis</Text>
          </Section>

          {/* ── Obsah ── */}
          <Section style={styles.content}>
            <Heading as="h1" style={styles.title}>
              Pozvání k žádosti o zápis dítěte
            </Heading>

            <Text style={styles.bodyText}>{greeting}</Text>

            <Text style={styles.bodyText}>
              {ownerName ? `${ownerName} Vás` : 'Byl(a) jste'} přidal(a) jako
              druhého zákonného zástupce k žádosti o zápis dítěte{' '}
              <strong>{childName}</strong> do {schoolName}.
            </Text>

            <Text style={styles.bodyText}>
              Pro dokončení registrace, potvrzení souhlasu s žádostí a doplnění
              vašich kontaktních údajů prosím klikněte na tlačítko níže:
            </Text>

            <Section style={styles.buttonWrapper}>
              <Button href={inviteUrl} style={styles.button}>
                Dokončit registraci
              </Button>
            </Section>

            <Text style={styles.mutedText}>
              Odkaz vás nejdřív provede ověřením e-mailu (jednorázový kód),
              stejně jako přihlášení do rodičovského portálu.
            </Text>

            <Hr style={styles.divider} />

            <Text style={styles.mutedText}>
              Pokud tlačítko nefunguje, zkopírujte prosím tento odkaz do
              prohlížeče:
              <br />
              {inviteUrl}
            </Text>
          </Section>

          {/* ── Patička ── */}
          <Section style={styles.footer}>
            <Text style={styles.footerText}>
              Tuto žádost najdete vždy v systému <strong>Nilsson</strong>.
            </Text>
            <Text style={{ ...styles.footerText, ...styles.footerSmall }}>
              Pokud si myslíte, že jste tento e-mail dostali omylem, prosím
              kontaktujte školu.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

export default GuardianInviteEmail;

// ─────────────────────────────────────────────────────────────
// Inline styly — převzato z emails/BulletinEmail.tsx (stejná paleta),
// doplněno jen o tlačítko, které bulletin nepotřeboval.
// ─────────────────────────────────────────────────────────────

const colors = {
  forest:  '#2d6a4f',
  fern:    '#40916c',
  sage:    '#d8f3dc',
  sand:    '#f8f4ef',
  bark:    '#5c4a37',
  muted:   '#7f6e5c',
  divider: '#d4c5b5',
  white:   '#ffffff',
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
  bodyText: {
    color: colors.bark,
    fontSize: '16px',
    lineHeight: '1.7',
    margin: '0 0 16px',
  },
  buttonWrapper: {
    textAlign: 'center',
    margin: '28px 0',
  },
  button: {
    backgroundColor: colors.forest,
    borderRadius: '6px',
    color: colors.white,
    fontSize: '16px',
    fontWeight: 'bold',
    textDecoration: 'none',
    padding: '14px 32px',
    display: 'inline-block',
  },
  mutedText: {
    color: colors.muted,
    fontSize: '13px',
    lineHeight: '1.6',
    margin: '0 0 8px',
    wordBreak: 'break-all',
  },
  divider: {
    borderColor: colors.divider,
    margin: '24px 0 16px',
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
