// Ready-made workflow templates (WF-11). A template becomes a normal draft the university then
// adapts; role keys match the system role templates copied into every tenant.

export interface WorkflowTemplate {
  key: string;
  nameFa: string;
  description: string;
  requestType: string;
  definition: unknown;
}

const reviewSla = { days: 5, businessDays: true, remindBefore: [2], remindAfter: [1, 3], onOverdue: 'escalate', escalateTo: { role: 'university_admin', scope: 'tenant' } };

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    key: 'general-request',
    nameFa: 'درخواست عمومی دانشجویی',
    description: 'یک مرحله بررسی کارشناس با امکان بازگشت برای اصلاح؛ مناسب گواهی‌ها و درخواست‌های ساده.',
    requestType: 'general_request',
    definition: {
      requestForm: [
        { key: 'subject', type: 'text', label: 'موضوع', required: true },
        { key: 'details', type: 'textarea', label: 'شرح درخواست', required: true },
        { key: 'attachment', type: 'file', label: 'پیوست' },
      ],
      start: 'expert-review',
      steps: [
        {
          id: 'expert-review',
          type: 'human',
          title: 'بررسی کارشناس',
          assignee: { role: 'expert', scope: 'case_unit_tree' },
          actions: ['approve', 'return_for_fix', 'reject'],
          form: [{ key: 'expertNote', type: 'textarea', label: 'یادداشت کارشناس', visibility: 'internal' }],
          sla: { days: 3, businessDays: true, remindBefore: [1], remindAfter: [1], onOverdue: 'notify' },
        },
        { id: 'approved', type: 'end', title: 'تأیید شد', outcome: 'success' },
        { id: 'rejected', type: 'end', title: 'رد شد', outcome: 'failure' },
      ],
      transitions: [
        { from: 'expert-review', action: 'approve', to: 'approved' },
        { from: 'expert-review', action: 'return_for_fix', to: '@applicant' },
        { from: 'expert-review', action: 'reject', to: 'rejected' },
      ],
    },
  },
  {
    key: 'thesis-proposal',
    nameFa: 'تصویب پروپوزال پایان‌نامه',
    description: 'تأیید استاد راهنما، بررسی کارشناس تحصیلات تکمیلی و داوری موازی برای دکتری؛ مسیر با مقطع تعیین می‌شود.',
    requestType: 'thesis_proposal',
    definition: {
      requestForm: [
        { key: 'title', type: 'text', label: 'عنوان پایان‌نامه', required: true },
        { key: 'degree', type: 'select', label: 'مقطع', required: true, options: [{ value: 'msc', label: 'کارشناسی ارشد' }, { value: 'phd', label: 'دکتری' }] },
        { key: 'advisorId', type: 'text', label: 'شناسه عضویت استاد راهنما', required: true },
        { key: 'proposal', type: 'file', label: 'فایل پروپوزال', required: true },
      ],
      start: 'advisor',
      steps: [
        {
          id: 'advisor',
          type: 'human',
          title: 'تأیید استاد راهنما',
          assignee: { dynamic: 'data.advisorId' },
          actions: ['approve', 'return_for_fix'],
          form: [],
          sla: { days: 7, businessDays: true, remindBefore: [2], remindAfter: [1], onOverdue: 'notify' },
        },
        {
          id: 'expert-check',
          type: 'human',
          title: 'بررسی کارشناس تحصیلات تکمیلی',
          assignee: { role: 'expert', scope: 'case_unit_tree' },
          actions: ['approve', 'return_for_fix', 'reject'],
          form: [{ key: 'checklist', type: 'checkbox', label: 'مدارک کامل است', visibility: 'internal', required: true }],
          sla: reviewSla,
        },
        { id: 'route', type: 'decision', title: 'مسیر بر اساس مقطع' },
        { id: 'reviews', type: 'parallel', title: 'داوری', branches: ['review-a', 'review-b'], join: 'all' },
        { id: 'review-a', type: 'human', title: 'داور اول', assignee: { role: 'faculty', scope: 'case_unit_tree' }, actions: ['approve', 'reject'], form: [{ key: 'reviewA', type: 'file', label: 'نظر داور اول', visibility: 'internal' }], sla: reviewSla },
        { id: 'review-b', type: 'human', title: 'داور دوم', assignee: { role: 'faculty', scope: 'tenant' }, actions: ['approve', 'reject'], form: [{ key: 'reviewB', type: 'file', label: 'نظر داور دوم', visibility: 'internal' }], sla: reviewSla },
        { id: 'verdict', type: 'decision', title: 'جمع‌بندی داوری' },
        { id: 'approved', type: 'end', title: 'پروپوزال تصویب شد', outcome: 'success' },
        { id: 'rejected', type: 'end', title: 'پروپوزال رد شد', outcome: 'failure' },
      ],
      transitions: [
        { from: 'advisor', action: 'approve', to: 'expert-check' },
        { from: 'advisor', action: 'return_for_fix', to: '@applicant' },
        { from: 'expert-check', action: 'approve', to: 'route' },
        { from: 'expert-check', action: 'return_for_fix', to: '@applicant' },
        { from: 'expert-check', action: 'reject', to: 'rejected' },
        { from: 'route', when: "data.degree == 'phd'", to: 'reviews' },
        { from: 'route', otherwise: true, to: 'approved' },
        { from: 'reviews', to: 'verdict' },
        { from: 'verdict', when: "case.decisions.review_a == 'approve' && case.decisions.review_b == 'approve'", to: 'approved' },
        { from: 'verdict', otherwise: true, to: 'rejected' },
      ],
    },
  },
  {
    key: 'paper-review',
    nameFa: 'داوری مقاله',
    description: 'بررسی اولیه، دو داوری هم‌زمان و تصمیم نهایی مدیر بررسی.',
    requestType: 'paper_submission',
    definition: {
      requestForm: [
        { key: 'title', type: 'text', label: 'عنوان مقاله', required: true },
        { key: 'abstract', type: 'textarea', label: 'چکیده', required: true },
        { key: 'manuscript', type: 'file', label: 'فایل مقاله', required: true },
      ],
      start: 'screening',
      steps: [
        { id: 'screening', type: 'human', title: 'بررسی اولیه', assignee: { role: 'review_manager', scope: 'tenant' }, actions: ['approve', 'return_for_fix', 'reject'], form: [], sla: { days: 3, businessDays: true, remindBefore: [1], remindAfter: [], onOverdue: 'notify' } },
        { id: 'reviews', type: 'parallel', title: 'داوری', branches: ['reviewer-1', 'reviewer-2'], join: 'all' },
        { id: 'reviewer-1', type: 'human', title: 'داور اول', assignee: { role: 'reviewer', scope: 'tenant' }, actions: ['accept', 'revise', 'reject'], form: [{ key: 'review1', type: 'textarea', label: 'نظر داور', visibility: 'internal', required: true }], sla: reviewSla },
        { id: 'reviewer-2', type: 'human', title: 'داور دوم', assignee: { role: 'reviewer', scope: 'tenant' }, actions: ['accept', 'revise', 'reject'], form: [{ key: 'review2', type: 'textarea', label: 'نظر داور', visibility: 'internal', required: true }], sla: reviewSla },
        { id: 'decision', type: 'human', title: 'تصمیم نهایی', assignee: { role: 'review_manager', scope: 'tenant' }, actions: ['accept', 'return_for_fix', 'reject'], form: [{ key: 'decisionNote', type: 'textarea', label: 'جمع‌بندی برای نویسنده' }] },
        { id: 'accepted', type: 'end', title: 'پذیرفته شد', outcome: 'success' },
        { id: 'rejected', type: 'end', title: 'رد شد', outcome: 'failure' },
      ],
      transitions: [
        { from: 'screening', action: 'approve', to: 'reviews' },
        { from: 'screening', action: 'return_for_fix', to: '@applicant' },
        { from: 'screening', action: 'reject', to: 'rejected' },
        { from: 'reviews', to: 'decision' },
        { from: 'decision', action: 'accept', to: 'accepted' },
        { from: 'decision', action: 'return_for_fix', to: '@applicant' },
        { from: 'decision', action: 'reject', to: 'rejected' },
      ],
    },
  },
];
