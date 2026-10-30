import { useTranslation } from 'react-i18next';

import { EmptyTab } from '@/components/EmptyTab';

export default function MapScreen() {
  const { t } = useTranslation();
  return (
    <EmptyTab title={t('mapEmptyTitle')} body={t('mapEmptyBody')} cta={t('mapEmptyCta')} />
  );
}
