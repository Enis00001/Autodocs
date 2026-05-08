// Script de calibration : génère un PDF CERFA test avec des valeurs
// identifiables pour vérifier visuellement le mapping des champs.
//
//   node scripts/test-cerfa-fill.mjs
//
// → écrit dans `cerfa-test-fill.pdf` à la racine du projet.

import { PDFDocument } from "pdf-lib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const SRC = path.join(ROOT, "public", "templates", "cerfa_15776-01.pdf");
const OUT = path.join(ROOT, "cerfa-test-fill.pdf");

const bytes = fs.readFileSync(SRC);
const doc = await PDFDocument.load(bytes);
const form = doc.getForm();

const setText = (name, value) => {
  try {
    form.getTextField(name).setText(String(value));
  } catch (e) {
    console.warn("text", name, "ERR", e.message);
  }
};
const checkBox = (name) => {
  try {
    form.getCheckBox(name).check();
  } catch (e) {
    console.warn("ckb", name, "ERR", e.message);
  }
};
const selectRadio = (name, option) => {
  try {
    form.getRadioGroup(name).select(option);
  } catch (e) {
    console.warn("radio", name, "ERR", e.message);
  }
};

// Pour les deux pages, on injecte les MÊMES valeurs identifiables.
for (const PG of ["Page1", "Page2"]) {
  const p = `topmostSubform[0].${PG}[0]`;

  // Véhicule
  setText(`${p}.num_Immatriculation[0]`, "AA-123-BB");
  setText(`${p}.num_Identification[0]`, "VIN12345678901234");
  setText(`${p}.num_DateImmatriculationJour[0]`, "01");
  setText(`${p}.num_DateImmatriculationMois[0]`, "06");
  setText(`${p}.num_DateImmatriculationAnnée[0]`, "2020");
  setText(`${p}.txt_MarqueVéhicule[0]`, "MARQUE-TEST");
  setText(`${p}.txt_TypeVarianteVersionVéhicule[0]`, "TYPE-X1");
  setText(`${p}.txt_GenreNational[0]`, "VP");
  setText(`${p}.txt_DénominationCommerciale[0]`, "MODELE-Y");
  setText(`${p}.num_KilométrageCompteur[0]`, "123456");
  setText(`${p}.num_Formule[0]`, "2020AB12345");
  setText(`${p}.txt_MotifAbscenceCertificat[0]`, "");
  setText(`${p}.num_DateCertificatJour[0]`, "");
  setText(`${p}.num_DateCertificatMois[0]`, "");
  setText(`${p}.num_DateCertificatAnnée[0]`, "");

  // Vendeur
  setText(`${p}.txt_IdentitéVendeur[0]`, "GARAGE TEST SARL");
  setText(`${p}.Num_Siret[0]`, "123456789");
  setText(`${p}.num_VoieAdresse[0]`, "12");
  setText(`${p}.txt_ExtensionAdresse[0]`, "bis");
  setText(`${p}.txt_TypeVoieAdresse[0]`, "rue");
  setText(`${p}.txt_NomVoie[0]`, "DE LA REPUBLIQUE");
  setText(`${p}.num_CodePostalAdresse[0]`, "69001");
  setText(`${p}.txt_CommuneAdresse[0]`, "LYON");
  setText(`${p}.num_DateVenteJour[0]`, "15");
  setText(`${p}.num_DateVenteMois[0]`, "05");
  setText(`${p}.num_DateVenteAnnée[0]`, "2026");
  setText(`${p}.num_HoraireVente1[0]`, "14");
  setText(`${p}.num_HoraireVente2[0]`, "30");
  setText(`${p}.num_Agrément[0]`, "");
  setText(`${p}.txt_LieuDéclaration1[0]`, "LYON");
  setText(`${p}.num_DateDéclaration[0]`, "15/05/2026");

  // Acheteur
  setText(`${p}.txt_IdentitéAcheteur[0]`, "DUPONT JEAN");
  setText(`${p}.num_SiretAcheteur[0]`, "");
  setText(`${p}.txt_LieuNaissanceAcheteur[0]`, "PARIS");
  setText(`${p}.num_DateNaissanceAcheteurJ[0]`, "07");
  setText(`${p}.num_DateNaissanceAcheteurM[0]`, "08");
  setText(`${p}.num_DateNaissanceAcheteurA[0]`, "1985");
  setText(`${p}.num_VoieAdresseAcheteur[0]`, "5");
  setText(`${p}.txt_ExtensionAdresseAcheteur[0]`, "");
  setText(`${p}.txt_TypeVoieAdresseAcheteur[0]`, "avenue");
  setText(`${p}.txt_NomVoieAdresseAcheteur[0]`, "DES TILLEULS");
  setText(`${p}.num_CodePostalAdresseAcheteur[0]`, "75011");
  setText(`${p}.txt_CommuneAdresseAcheteur[0]`, "PARIS");
  setText(`${p}.txt_LieuDéclaration2[0]`, "LYON");
  setText(`${p}.txt_dateDéclaration[0]`, "15/05/2026");

  // Tous les radios à "1" pour calibrer
  selectRadio(`${p}.Groupe_de_boutons_radio1[0]`, "1");
  selectRadio(`${p}.Groupe_de_boutons_radio2[0]`, "1");
  selectRadio(`${p}.Groupe_de_boutons_radio3[0]`, "1");
  selectRadio(`${p}.Groupe_de_boutons_radio4[0]`, "1");
  selectRadio(`${p}.Groupe_de_boutons_radio5[0]`, "1");
  selectRadio(`${p}.Groupe_de_boutons_radio6[0]`, "1");

  // Toutes les checkboxes à cocher
  checkBox(`${p}.ckb_ValidationDéclaration1[0]`);
  checkBox(`${p}.ckb_ValidationDéclaration2[0]`);
  checkBox(`${p}.ckb_ValidationDéclaration3[0]`);
  checkBox(`${p}.ckb_ValidationDéclarationA1[0]`);
  checkBox(`${p}.ckb_ValidationDéclarationA2[0]`);
  // ckb_OppositionUtilisationDonnée laissée NON cochée (position connue)
}

// On fige les valeurs pour qu'elles soient lisibles partout.
form.flatten();

const out = await doc.save();
fs.writeFileSync(OUT, out);
console.log("OK →", OUT, "(", out.byteLength, "bytes )");
