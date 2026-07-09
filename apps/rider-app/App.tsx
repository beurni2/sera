import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { seraTheme as theme } from '@platform/ui-tokens';
import { t } from './src/i18n';

/**
 * SE0.1 rider shell: one sparse screen on ui-tokens (sera theme —
 * road-and-custody clarity) and catalog strings, with an honest designed
 * empty state. Metro-safe by construction: the RN bundle imports only pure
 * token data; node-only canon barrels stay type-only (sibling lesson,
 * enforced by a ban-test). The shift/work flows arrive at SE0.2+. The
 * canonical « Commencer service » action label is deliberately absent — it
 * fails the maintained reading-level budget (collision instance #2, with
 * the founder). Sparse ≠ ugly.
 */
export default function App() {
  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" backgroundColor={theme.colors.surface} />
      <View style={styles.content}>
        <Text style={styles.brand}>{t('app.title')}</Text>
        <Text style={styles.tab}>{t('shell.work_tab')}</Text>
        <View style={styles.card}>
          <Text style={styles.emptyState}>{t('shell.no_task')}</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.surface,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    padding: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  brand: {
    color: theme.colors.primary,
    fontSize: theme.typeScale.title.size,
    lineHeight: theme.typeScale.title.lineHeight,
    fontWeight: theme.typeScale.title.weight,
    textAlign: 'center',
  },
  tab: {
    color: theme.colors.inkMuted,
    fontSize: theme.typeScale.label.size,
    lineHeight: theme.typeScale.label.lineHeight,
    fontWeight: theme.typeScale.label.weight,
    textAlign: 'center',
  },
  card: {
    backgroundColor: theme.colors.surfaceRaised,
    borderRadius: theme.radius.lg,
    borderColor: theme.colors.line,
    borderWidth: StyleSheet.hairlineWidth,
    padding: theme.spacing.xl,
    marginTop: theme.spacing.lg,
  },
  emptyState: {
    color: theme.colors.inkMuted,
    fontSize: theme.typeScale.bodyLarge.size,
    lineHeight: theme.typeScale.bodyLarge.lineHeight,
    textAlign: 'center',
  },
});
