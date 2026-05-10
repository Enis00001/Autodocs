import DraftsListPage from "@/pages/DraftsListPage";

// Page unique qui regroupe tous les bons de commande : brouillons en cours,
// bons complets, bons signés. Elle remplace l'ancienne page « Brouillons ».
// La route /brouillons est conservée en redirect vers /historique (cf. App.tsx).
const Historique = () => (
  <DraftsListPage
    topBarTitle="Historique"
    topBarSubtitle="Tous vos bons de commande — brouillons, complets et signés"
    dateFilterInputId="historique-date"
  />
);

export default Historique;
