/**
 * core/cloudConfig.js — à remplir une fois le projet Supabase créé.
 * Supabase → Project Settings → API :
 *   url     = « Project URL »            (https://xxxxxxxx.supabase.co)
 *   anonKey = clé « anon » / « publishable »
 * Cette clé est PUBLIQUE par conception : la sécurité vient des règles RLS de supabase/schema.sql.
 * Ne mettez JAMAIS ici la clé « service_role » (ni aucune clé « secret »).
 * googleClientId : ID client OAuth « Application Web » (Google Cloud Console), public lui aussi.
 * Il active le bouton officiel « Se connecter avec Google » (fenêtre Google au nom de l'application) ;
 * sans lui, la connexion Google passe par une redirection vers Supabase. Le secret client reste dans Supabase.
 */
'use strict';

const CLOUD_CONFIG = {
    url:     'https://axkwnkqdslabcqhaiati.supabase.co',
    anonKey: 'sb_publishable_h0-dyHTbEMUvbCUPRV1a_Q_QeGqd0s2',
    googleClientId: '893278034782-poeqfnldig6adp1cjbnbjte6ipemmbs8.apps.googleusercontent.com'
};
