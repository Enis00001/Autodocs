import { useCallback, useEffect, useState } from "react";
import { DEFAULT_FORM_PREFS, loadFormPrefs, type FormFieldPrefs } from "@/utils/formPreferences";

export function usePreferencesFormulaire() {
  const [formPrefs, setFormPrefs] = useState<FormFieldPrefs>(DEFAULT_FORM_PREFS);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const merged = await loadFormPrefs();
    setFormPrefs(merged);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const onUpdated = () => void refresh();
    window.addEventListener("autodocs_form_prefs_updated", onUpdated);
    return () => {
      window.removeEventListener("autodocs_form_prefs_updated", onUpdated);
    };
  }, [refresh]);

  const champsPersonnalises = formPrefs.fields.filter((f) => f.isCustom);
  const champsActifs = Object.fromEntries(formPrefs.fields.map((f) => [f.id, f.enabled])) as Record<
    string,
    boolean
  >;

  return {
    formPrefs: formPrefs,
    champsPersonnalises,
    champsActifs,
    loading,
    refresh,
  };
}
