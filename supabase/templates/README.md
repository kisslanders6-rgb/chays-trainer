# Modèles d'e-mails (Supabase Auth)

À coller dans Supabase → **Authentication → Emails → Templates** : pour chaque modèle, remplacez l'objet et le contenu (onglet « Source »), puis **Save changes**.

| Modèle Supabase        | Fichier             | Objet                                              |
|------------------------|---------------------|----------------------------------------------------|
| Confirm sign up        | `confirmation.html` | Confirmez votre adresse e-mail — Chays Trainer     |
| Reset password         | `recovery.html`     | Réinitialisation de votre mot de passe — Chays Trainer |
| Change email address   | `email_change.html` | Confirmez votre nouvelle adresse — Chays Trainer   |
| Magic link             | `magic_link.html`   | Votre lien de connexion — Chays Trainer            |

Le logo est chargé depuis `https://chays-trainer.vercel.app/assets/icons/icon-192.png` : si l'adresse de l'application change, mettez-la à jour dans les quatre fichiers.

La mention « powered by Supabase » et l'expéditeur Supabase disparaissent seulement avec un serveur d'envoi personnel (Authentication → Emails → SMTP Settings).
