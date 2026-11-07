import { supabase } from './auth-client.js';

const categories = [
  { id: 'beginnings', title: 'Our beginnings', description: 'The origins of the youth group, the people who helped establish it and the early story of our community.' },
  { id: 'faith-fellowship', title: 'Faith & fellowship', description: 'Our spiritual journey, shared prayer, formation, fellowship and the values that keep us united.' },
  { id: 'leadership-service', title: 'Leadership & service', description: 'Past leadership teams, their contributions and the service carried out across our parish.' },
  { id: 'projects-milestones', title: 'Projects & milestones', description: 'Community initiatives, outreach, events and important moments worth remembering.' },
  { id: 'photo-memories', title: 'Photo memories', description: 'A carefully organised collection of photographs and captions from different generations.' }
];
const grid = document.getElementById('history-collection-grid');
function dateLabel(value) {
  if (!value) return 'Date not recorded';
  return new Intl.DateTimeFormat('en-KE', { dateStyle: 'long', timeZone: 'Africa/Nairobi' }).format(new Date(value + 'T00:00:00'));
}
async function entryCard(entry) {
  const card = document.createElement('article');
  card.className = 'history-entry-card';
  if (entry.photo_path) {
    const img = document.createElement('img');
    const photoResult = await supabase.storage.from('heritage-media').createSignedUrl(entry.photo_path, 3600);
    if (photoResult.error) throw photoResult.error;
    img.src = photoResult.data.signedUrl;
    img.alt = entry.photo_caption || entry.title;
    card.append(img);
  }
  const content = document.createElement('div');
  content.className = 'history-entry-copy';
  const date = document.createElement('p');
  date.className = 'eyebrow blue';
  date.textContent = dateLabel(entry.event_date);
  const title = document.createElement('h3');
  title.textContent = entry.title;
  const body = document.createElement('p');
  body.textContent = entry.body;
  content.append(date, title, body);
  if (entry.photo_caption) {
    const caption = document.createElement('p');
    caption.className = 'history-photo-caption';
    caption.textContent = entry.photo_caption;
    content.append(caption);
  }
  card.append(content);
  return card;
}
async function loadHistory() {
  const status = document.getElementById('history-load-status');
  try {
    const result = await supabase.from('published_heritage_entries')
      .select('id,title,category,body,event_date,photo_path,photo_caption,created_at')
      .eq('status', 'published')
      .order('event_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });
    if (result.error) throw result.error;
    const entries = result.data || [];
    grid.replaceChildren();
    categories.forEach(category => {
      const section = document.createElement('section');
      section.className = 'history-category-section';
      const heading = document.createElement('div');
      heading.className = 'history-category-heading';
      const eyebrow = document.createElement('p');
      eyebrow.className = 'eyebrow blue';
      eyebrow.textContent = 'OUR HERITAGE';
      const title = document.createElement('h2');
      title.textContent = category.title;
      const description = document.createElement('p');
      description.textContent = category.description;
      heading.append(eyebrow, title, description);
      section.append(heading);
      const matching = entries.filter(entry => entry.category === category.id);
      if (matching.length) {
        const cards = document.createElement('div');
        cards.className = 'history-entry-grid';
        const entryCards = await Promise.all(matching.map(entry => entryCard(entry)));
        entryCards.forEach(card => cards.append(card));
        section.append(cards);
      } else {
        const empty = document.createElement('p');
        empty.className = 'history-empty';
        empty.textContent = 'No verified records have been published in this collection yet.';
        section.append(empty);
      }
      grid.append(section);
    });
    status.textContent = entries.length
      ? entries.length + ' verified history record' + (entries.length === 1 ? '' : 's') + ' in our archive.'
      : 'The archive is ready. Verified historical records will appear here as they are approved and published.';
  } catch (error) {
    status.textContent = 'The history archive could not be loaded right now. Please refresh the page.';
    console.error('History archive load failed', error);
  }
}
loadHistory();

async function setupMemorySubmission() {
  const form = document.getElementById('heritage-memory-form');
  if (!form) return;
  try {
    const sessionResult = await supabase.auth.getSession();
    const user = sessionResult.data.session && sessionResult.data.session.user;
    if (!user) return;
    const profileResult = await supabase.from('profiles').select('membership_status').eq('id', user.id).single();
    if (!profileResult.error && profileResult.data && profileResult.data.membership_status === 'approved') form.hidden = false;
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const status = document.getElementById('memory-submit-status');
      status.textContent = 'Submitting your memory…';
      const payload = {
        title: document.getElementById('memory-title').value.trim(),
        category: document.getElementById('memory-category').value,
        event_date: document.getElementById('memory-date').value || null,
        body: document.getElementById('memory-body').value.trim(),
        status: 'pending',
        created_by: user.id
      };
      const result = await supabase.from('heritage_entries').insert(payload);
      if (result.error) {
        status.textContent = 'Your memory could not be submitted. Please try again.';
        console.error('Memory submission failed', result.error);
        return;
      }
      form.reset();
      status.textContent = 'Thank you. Your memory has been sent for parish review and is not public yet.';
    });
  } catch (error) {
    console.error('Could not initialise member memory form', error);
  }
}
setupMemorySubmission();
