# Privacy Policy — amzinvite

**Dernière mise à jour :** 2026-05-21

amzinvite est une extension Chrome conçue pour respecter ta vie privée. Aucune authentification, aucun compte, aucune donnée perso requise.

## Données stockées localement (chrome.storage.local)

Toutes ces données restent **uniquement dans ton navigateur** et ne sont jamais transmises à nos serveurs ni à des tiers :

- `instanceId` : UUID anonyme généré au premier lancement
- `intervalMin`, `autoRequest`, `telemetryEnabled`, `scrapeEnabled` : tes préférences
- `customUrls` : les URLs Amazon que tu as ajoutées manuellement
- `knownStates` : l'état détecté pour chaque produit suivi
- `publicFeed` : copie locale du feed public (cache)
- `autoSpawnLog`, `lastRun`, `checkProgress` : état interne de l'extension

Tu peux tout supprimer à tout moment via le bouton **"Reset"** dans les paramètres.

## Données envoyées à nos serveurs

### Feed public (toujours actif)
L'extension récupère la liste des produits Amazon actuellement en mode invitation depuis notre endpoint public :

```
GET https://amzinvite.example.com/api/public/invitations
```

C'est une **requête anonyme** (aucun header d'identification). Notre serveur enregistre éventuellement l'IP dans les logs HTTP standards pour le rate-limiting, conservée 7 jours puis supprimée.

### Feedback de détection (opt-in via toggle "Aider la communauté")
Si tu actives cette option, l'extension envoie pour chaque produit dont elle détecte un changement d'état :

```json
{
  "asin": "B0XXXXXXXX",
  "state": "available" | "already_requested" | "accepted" | "not_invitation",
  "source": "bg_check" | "manual_visit" | "auto_request",
  "observedAt": 1779380900
}
```

Headers envoyés :
- `X-Instance-Id` : ton UUID anonyme local
- `X-Ts`, `X-Sig` : timestamp et signature HMAC (anti-spoof)

**Ce qui n'est PAS envoyé :** ton compte Amazon, ton nom, ton email, ton historique de navigation, le contenu de tes achats, ton IP brute (juste un hash).

### Observations Amazon (opt-in via toggle "Contribuer au catalogue")
Si tu actives cette option, quand tu visites une page produit Amazon ou que tu fais une recherche, l'extension envoie :

```json
{
  "items": [
    { "asin": "B0XXXXXXXX", "price": 1999, "in_stock": true, "name": "..." }
  ],
  "dayBucket": "2026-05-21"
}
```

**Aucun instanceId n'est envoyé** avec ces observations — elles sont totalement anonymes. Le serveur agrège uniquement par produit, pas par utilisateur.

## Données envoyées à Amazon

Quand l'option **"Auto-demander les invitations"** est activée, l'extension envoie une requête POST à l'endpoint d'invitation d'Amazon :

```
POST https://data.amazon.fr/custom/highdemandproductcontracts/request-invite/{uuid}
```

Cette requête utilise **tes propres cookies** de session Amazon (comme si tu avais cliqué le bouton manuellement). Aucune donnée ne transite par nos serveurs dans ce flux.

## Tes droits (RGPD)

L'instanceId étant un pseudonyme non lié à ton identité, nous n'avons aucun moyen de t'identifier. Tu peux à tout moment :

1. **Reset complet** : bouton "Reset" dans les paramètres → ton UUID est régénéré, ton historique local supprimé
2. **Désactiver les opt-in** : décoche les toggles "Aider la communauté" et "Contribuer au catalogue"
3. **Désinstaller l'extension** : toutes les données locales sont supprimées par Chrome
4. **Demande d'effacement serveur** : envoie ton instanceId à privacy@amzinvite.example.com — nous supprimerons toutes les données associées sous 30 jours

## Hébergement

Les données agrégées sont stockées sur des serveurs en Europe (région à préciser). Aucune donnée n'est transférée hors UE.

## Bases légales (RGPD)

- **Article 6.1.f** : intérêt légitime à fournir un service de tracker d'invitations et à améliorer la qualité de notre feed
- **Article 13** : information transparente sur les traitements
- **Article 25** : privacy by design — opt-in par défaut, minimisation des données

## Changements

Si cette politique change, la version mise à jour sera publiée à `https://amzinvite.example.com/privacy` et notifiée via une bannière dans le popup de l'extension.

## Contact

Pour toute question relative à cette politique : privacy@amzinvite.example.com
