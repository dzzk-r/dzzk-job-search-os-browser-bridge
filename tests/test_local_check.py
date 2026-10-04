import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('local_check', Path(__file__).resolve().parents[1] / 'scripts/local-check.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


def response(text='Finding with evidence.', reason='stop'):
    return {'choices': [{'message': {'content': text}, 'finish_reason': reason}],
            'usage': {'prompt_tokens': 100, 'completion_tokens': 10}}


class ReviewInputTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name) / 'repo'
        self.repo.mkdir()

    def test_exact_character_bound_and_hash(self):
        source = self.repo / 'input.txt'
        source.write_text('я' * 8000, encoding='utf-8')
        text, digest, path = runner.load_review_input(self.repo, Path('input.txt'))
        self.assertEqual(len(text), 8000)
        self.assertEqual(digest, runner.hashlib.sha256(source.read_bytes()).hexdigest())
        self.assertEqual(path, str(source.resolve()))
        source.write_text('я' * 8001, encoding='utf-8')
        with self.assertRaises(ValueError):
            runner.load_review_input(self.repo, source)

    def test_missing_empty_and_invalid_utf8(self):
        with self.assertRaises(ValueError):
            runner.load_review_input(self.repo, None)
        source = self.repo / 'input.txt'
        for content in [b' \n', b'\xff']:
            source.write_bytes(content)
            with self.assertRaises(ValueError):
                runner.load_review_input(self.repo, source)

    def test_outside_and_symlink_escape(self):
        outside = self.repo.parent / 'outside.txt'
        outside.write_text('source')
        link = self.repo / 'link.txt'
        link.symlink_to(outside)
        for path in [outside, link, Path('../outside.txt')]:
            with self.assertRaises(ValueError):
                runner.load_review_input(self.repo, path)

    def test_invalid_input_prevents_checks_and_model_calls(self):
        argv = ['local-check.py', '--repo', str(self.repo), '--review']
        with patch.object(sys, 'argv', argv), patch.object(runner, 'local_json') as model, patch.object(runner, 'run_step') as checks:
            with self.assertRaises(SystemExit) as error:
                runner.main()
        self.assertEqual(error.exception.code, 2)
        model.assert_not_called()
        checks.assert_not_called()


class ResponseTests(unittest.TestCase):
    def test_completed_preserves_content_usage(self):
        result = runner.classify_review_response(response())
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(result['text'], 'Finding with evidence.')
        self.assertEqual(result['usage']['completion_tokens'], 10)

    def test_empty_whitespace_and_non_string_fail(self):
        for text in ['', ' \n', None, 123]:
            with self.subTest(text=text):
                self.assertEqual(runner.classify_review_response(response(text))['status'], 'failed')

    def test_truncated_or_unknown_finish_is_incomplete(self):
        for reason in ['length', 'tool_calls', None]:
            with self.subTest(reason=reason):
                self.assertEqual(runner.classify_review_response(response(reason=reason))['status'], 'incomplete')

    def test_malformed_choices_fail_without_exception(self):
        for value in [None, [], {}, {'choices': []}, {'choices': [None]}, {'choices': [{'message': None}]}, {'choices': 'bad'}]:
            with self.subTest(value=value):
                self.assertEqual(runner.classify_review_response(value)['status'], 'failed')

    def test_incomplete_review_exits_nonzero_with_checks_still_passed(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory)
            (repo / 'node_modules').mkdir()
            (repo / 'input.txt').write_text('Focused source excerpt.')
            argv = ['local-check.py', '--repo', str(repo), '--review', '--review-input', 'input.txt']
            step = {'status': 'passed'}
            with patch.object(sys, 'argv', argv), patch.object(runner, 'snapshot', return_value={'head': 'stable'}), patch.object(runner, 'run_step', return_value=step), patch.object(runner, 'local_json', side_effect=[[{'is_processing': False}], response(reason='length')]) as model:
                self.assertEqual(runner.main(), 1)
            report = json.loads(next(repo.glob('artifacts/local-check/*/report.json')).read_text())
            self.assertTrue(report['checks_passed'])
            self.assertEqual(report['review']['status'], 'incomplete')
            request = json.loads(next(repo.glob('artifacts/local-check/*/review-request.json')).read_text())
            self.assertEqual(request['max_tokens'], 400)
            self.assertEqual(model.call_args.kwargs['timeout'], 120)
            self.assertEqual(model.call_count, 2)  # slots and one completion, no retries


if __name__ == '__main__':
    unittest.main()
